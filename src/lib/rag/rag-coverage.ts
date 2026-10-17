import { sanitizeRagEvalDiagnostics } from "@/lib/rag/rag-eval-diagnostics";
import { evaluateEvidenceCoverageGate } from "@/lib/rag/rag-coverage-gate";
import type { RagCandidateMatchCounts } from "@/lib/rag/rag-contracts";
import { classifyRagQuery, medicationDoseEvidenceQueryIntent } from "@/lib/clinical-search";
import { annotateSearchResults, buildEvidenceRelevance } from "@/lib/evidence-relevance";
import { coverageQueryForSubquestion } from "@/lib/rag/rag-query-plan";
import {
  compareAustralianSourcesWithinRelevanceBand,
  selectAustralianClinicalContext,
} from "@/lib/australian-source-priority";
import { evidenceFamilyKeys, siteContentClaimPolicy } from "@/lib/site-content/site-content-registry";
import { classifyRagFallbackReason, isStrongerGovernanceFallbackReasonCode } from "@/lib/rag/rag-fallback-reason";
import type { SiteContentRecord } from "@/lib/site-content/site-content-contracts";
import { normalizeClinicalSourceMetadata } from "@/lib/source-metadata";
import {
  classifyClaimRoleForSubquestion,
  resolveLocalAndAustralianEvidence,
  retainCanonicalSourcePolicyConflicts,
  searchResultEligibilityForClaim,
} from "@/lib/source-role-policy";
import type {
  AnswerCoveragePlan,
  ClinicalAmbiguity,
  ClinicalClaimRole,
  RagAnswer,
  RagInsufficiencyReason,
  RagQueryPlan,
  SearchResult,
  SiteContentDomain,
  SiteContentPartitionState,
  SourceCorpusScope,
  SourcePolicyConflict,
  SmartRagAnswerPlan,
} from "@/lib/types";

const knownCorpusScopes = new Set<SourceCorpusScope>([
  "uploaded_local",
  "clinical_kb_site",
  "australian_public",
  "international_supplementary",
]);

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
  /** Explicit output of the existing role/governance selection. Omission fails closed at runtime. */
  eligibleChunkIds: readonly string[];
  /** Explicit direct-support decision for query classes without a canonical evidence gate. */
  support: "direct" | "partial";
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

export type CoverageMergeInput = {
  plan: RagQueryPlan;
  candidates: readonly SearchResult[];
  claimRole?: ClinicalClaimRole;
  sourcePolicyConflicts?: readonly SourcePolicyConflict[];
  siteContentState?: SiteContentPartitionState;
  maxPerSubquestion?: number;
  maxPerDocument?: number;
};

export type CoverageEvidenceSelection = {
  subquestionId: string;
  claimRole: ClinicalClaimRole;
  orderedEvidence: SearchResult[];
  collapsedEvidenceFamilyIds: string[];
  conflicts: SourcePolicyConflict[];
  sourcePolicyReview: "not_applicable" | "not_evaluated" | "verified_conflict";
  /** True when at least one verified conflict pair could not fit atomically inside the hard context budget. */
  sourcePolicyConflictOmitted?: boolean;
  coverageReason:
    "direct" | "partial" | "not_in_corpus" | "site_content_updating" | "site_content_stale" | "source_role_mismatch";
};

type CandidateWithOrder = { result: SearchResult; inputIndex: number };

type CoverageBudgetLane = Pick<CoverageEvidenceSelection, "subquestionId" | "orderedEvidence" | "conflicts">;
type CoverageBudgetUnit = { results: SearchResult[]; conflict: boolean };

function metadataRecord(result: SearchResult): Record<string, unknown> {
  return result.source_metadata && typeof result.source_metadata === "object"
    ? (result.source_metadata as unknown as Record<string, unknown>)
    : {};
}

function stableTextHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function evidenceFamilyIdsForResult(result: SearchResult) {
  const metadata = metadataRecord(result);
  const contentHash = typeof metadata.content_hash === "string" && metadata.content_hash ? metadata.content_hash : null;
  const lineage: SiteContentRecord["sourceLineage"] = Array.isArray(metadata.site_content_lineage)
    ? metadata.site_content_lineage.flatMap((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
        const value = entry as Record<string, unknown>;
        if (
          typeof value.sourceId !== "string" ||
          typeof value.sourceHash !== "string" ||
          (value.relationship !== "derived_from" && value.relationship !== "references")
        )
          return [];
        return [
          {
            sourceId: value.sourceId,
            sourceHash: value.sourceHash,
            relationship: value.relationship,
          },
        ];
      })
    : [];
  if (contentHash || lineage.length) {
    return evidenceFamilyKeys({
      sourceId: result.document_id,
      sourceHash: contentHash ?? `document-${stableTextHash(result.document_id)}`,
      sourceLineage: lineage,
    });
  }
  // No lineage means no safe cross-row family decision. Keep the candidate distinct;
  // exact public-release admission and document crowding remain the outer bounds.
  return [`source-family:chunk-${stableTextHash(result.id)}`];
}

function productIntent(plan: RagQueryPlan, question: string, result: SearchResult) {
  if (result.corpus_scope !== "clinical_kb_site" || !result.site_content_domain) return false;
  if (
    plan.siteDomainDecision === "explicit" &&
    plan.targetSiteDomains.length > 0 &&
    !plan.targetSiteDomains.includes(result.site_content_domain)
  )
    return false;
  const queryClass = classifyRagQuery(question).queryClass;
  const doseIntent = medicationDoseEvidenceQueryIntent(question);
  const explicitProductTarget =
    /\b(?:medication|differential|specifier|service|form|therapy|dictionary|calculator|tool)\s+(?:record|page)\b|\bcatalog(?:ue)?\b/i.test(
      question,
    );
  const explicitLookupAction =
    queryClass === "document_lookup" ||
    /\b(?:which|find|search|lookup|open|show|where)\b/i.test(question) ||
    /\bcatalog(?:ue)?\b/i.test(question) ||
    /\b(?:record|page|catalog(?:ue)?)\b.{0,40}\b(?:available|exists?)\b/i.test(question);
  const clinicalClaimIntent =
    doseIntent.asksAmount ||
    doseIntent.asksFrequency ||
    doseIntent.asksRoute ||
    queryClass === "table_threshold" ||
    /\b(?:monitor(?:ed|ing)?|recommend(?:ed|ation)?|prescrib(?:e|ed|ing)|treat(?:ment|ed|ing)?|how\s+should)\b/i.test(
      question,
    );
  return explicitProductTarget && explicitLookupAction && !clinicalClaimIntent;
}

function legacySiteCandidateRejected(result: SearchResult) {
  if (result.corpus_scope !== "clinical_kb_site") return false;
  const metadata = metadataRecord(result);
  return (
    (typeof metadata.row_owner_id === "string" && metadata.row_owner_id.length > 0) ||
    metadata.explicitly_reconciled === false ||
    (typeof metadata.publication_state === "string" && metadata.publication_state !== "published")
  );
}

function claimRoleForSubquestion(input: CoverageMergeInput, subquestion: RagQueryPlan["subquestions"][number]) {
  return input.claimRole ?? classifyClaimRoleForSubquestion(subquestion);
}

function eligibilityForCandidate(args: {
  input: CoverageMergeInput;
  question: string;
  claimRole: ClinicalClaimRole;
  result: SearchResult;
}) {
  const { input, question, claimRole, result } = args;
  if (!candidateHasKnownServerScope(result) || legacySiteCandidateRejected(result)) {
    return { eligible: false, roleMismatch: false };
  }
  const metadata = normalizeClinicalSourceMetadata(result.source_metadata);
  if (metadata.corpus_scope !== result.corpus_scope) return { eligible: false, roleMismatch: false };
  if (productIntent(input.plan, question, result) && metadata.source_role) {
    const policy = siteContentClaimPolicy({
      claimKind: "product_catalogue",
      siteSourceRole: metadata.source_role,
      directlyRelevantUploadedGuideline: false,
    });
    const eligibleProductRecord =
      policy.primaryCorpus === "clinical_kb_site" &&
      metadata.source_kind === "registry_record" &&
      metadata.content_mode === "indexed_content" &&
      metadata.document_status === "current" &&
      (metadata.clinical_validation_status === "approved" ||
        metadata.clinical_validation_status === "locally_reviewed") &&
      metadata.extraction_quality === "good";
    return { eligible: eligibleProductRecord, roleMismatch: !eligibleProductRecord };
  }
  const decision = searchResultEligibilityForClaim(result, claimRole);
  if (decision.eligible) return { eligible: true, roleMismatch: false };
  return { eligible: false, roleMismatch: decision.reason === "role_mismatch" || decision.reason === "link_only" };
}

function annotateSubquestionRelevance(question: string, candidate: CandidateWithOrder): CandidateWithOrder {
  const withoutPriorRelevance = { ...candidate.result };
  delete withoutPriorRelevance.relevance;
  return {
    ...candidate,
    result: annotateSearchResults(question, [withoutPriorRelevance])[0] ?? withoutPriorRelevance,
  };
}

function relevanceRank(result: SearchResult) {
  return result.relevance?.verdict === "direct"
    ? 0
    : result.relevance?.verdict === "partial"
      ? 1
      : result.relevance?.verdict === "nearby"
        ? 2
        : 3;
}

function orderedByPolicy(args: {
  input: CoverageMergeInput;
  question: string;
  candidates: CandidateWithOrder[];
  claimRole: ClinicalClaimRole;
}) {
  const local = args.candidates
    .filter(({ result }) => result.corpus_scope === "uploaded_local")
    .map(({ result }) => result);
  const australian = args.candidates
    .filter(({ result }) => result.corpus_scope === "australian_public")
    .map(({ result }) => result);
  const conflictDecision = resolveLocalAndAustralianEvidence({
    local,
    australian,
    claimRole: args.claimRole,
    verifiedDifferences: [],
  });
  const conflicts = retainCanonicalSourcePolicyConflicts({
    conflicts: args.input.sourcePolicyConflicts ?? [],
    local,
    australian,
    claimRole: args.claimRole,
  });
  const localPrimary = conflictDecision.primaryDecision.selected === "uploaded_local";
  const ordered: SearchResult[] = [];
  const add = (items: CandidateWithOrder[]) =>
    items.forEach(({ result }) => !ordered.includes(result) && ordered.push(result));

  for (const band of [0, 1, 2]) {
    const inBand = args.candidates.filter(({ result }) => relevanceRank(result) === band);
    const site = inBand.filter(({ result }) => result.corpus_scope === "clinical_kb_site");
    const uploaded = inBand.filter(({ result }) => result.corpus_scope === "uploaded_local");
    const au = inBand
      .filter(({ result }) => result.corpus_scope === "australian_public")
      .sort(
        (left, right) =>
          compareAustralianSourcesWithinRelevanceBand(left.result, right.result) || left.inputIndex - right.inputIndex,
      );
    const international = inBand.filter(({ result }) => result.corpus_scope === "international_supplementary");
    if (site.some(({ result }) => productIntent(args.input.plan, args.question, result))) add(site);
    if (localPrimary) {
      add(uploaded);
      add(au);
    } else {
      add(au);
      add(uploaded);
    }
    add(site);
    add(international);
  }
  const directlyRelevantLocal = args.candidates.some(
    ({ result }) => result.corpus_scope === "uploaded_local" && result.relevance?.verdict === "direct",
  );
  const directlyRelevantAustralian = args.candidates.some(
    ({ result }) => result.corpus_scope === "australian_public" && result.relevance?.verdict === "direct",
  );
  return {
    ordered,
    conflicts,
    sourcePolicyReview: conflicts.length
      ? ("verified_conflict" as const)
      : directlyRelevantLocal && directlyRelevantAustralian
        ? ("not_evaluated" as const)
        : ("not_applicable" as const),
  };
}

function collapseEvidenceFamilies(results: SearchResult[], conflicts: readonly SourcePolicyConflict[]) {
  const protectedIds = new Set<string>();
  for (const conflict of conflicts) {
    const local = results.find((result) => conflict.local.supportingChunkIds.includes(result.id));
    const australian = results.find((result) => conflict.australian.supportingChunkIds.includes(result.id));
    if (local) protectedIds.add(local.id);
    if (australian) protectedIds.add(australian.id);
  }
  const protectedResults = results.filter((result) => protectedIds.has(result.id));
  const reservedFamilies = new Set(protectedResults.flatMap(evidenceFamilyIdsForResult));
  const reservedLogicalIds = new Set(
    protectedResults.flatMap((result) => {
      const logicalId = metadataRecord(result).site_content_logical_id;
      return typeof logicalId === "string" && logicalId ? [logicalId] : [];
    }),
  );
  const seenFamilies = new Set<string>();
  const seenLogicalIds = new Set<string>();
  const orderedEvidence: SearchResult[] = [];
  const collapsedEvidenceFamilyIds: string[] = [];
  for (const result of results) {
    const families = evidenceFamilyIdsForResult(result);
    const newFamilies = families.filter((family) => !seenFamilies.has(family));
    const logicalId = metadataRecord(result).site_content_logical_id;
    const protectedConflictMember = protectedIds.has(result.id);
    if (
      !protectedConflictMember &&
      (families.some((family) => reservedFamilies.has(family)) ||
        (typeof logicalId === "string" && logicalId && reservedLogicalIds.has(logicalId)))
    )
      continue;
    if (!protectedConflictMember && newFamilies.length === 0) continue;
    if (!protectedConflictMember && typeof logicalId === "string" && logicalId && seenLogicalIds.has(logicalId))
      continue;
    newFamilies.forEach((family) => seenFamilies.add(family));
    if (typeof logicalId === "string" && logicalId) seenLogicalIds.add(logicalId);
    orderedEvidence.push(result);
    collapsedEvidenceFamilyIds.push(...newFamilies);
  }
  return { orderedEvidence, collapsedEvidenceFamilyIds: [...new Set(collapsedEvidenceFamilyIds)] };
}

function retainedSelectionConflicts(conflicts: SourcePolicyConflict[], results: SearchResult[]) {
  const retainedIds = new Set(results.map((result) => result.id));
  return conflicts.filter(
    (conflict) =>
      conflict.local.supportingChunkIds.some((id) => retainedIds.has(id)) &&
      conflict.australian.supportingChunkIds.some((id) => retainedIds.has(id)),
  );
}

export function conflictPairForEvidence(lane: CoverageBudgetLane, resultId: string) {
  const conflict = lane.conflicts.find((candidate) =>
    [...candidate.local.supportingChunkIds, ...candidate.australian.supportingChunkIds].includes(resultId),
  );
  if (!conflict) return null;
  const local = lane.orderedEvidence.find((result) => conflict.local.supportingChunkIds.includes(result.id));
  const australian = lane.orderedEvidence.find((result) => conflict.australian.supportingChunkIds.includes(result.id));
  return local && australian ? [local, australian] : null;
}

/** Apply hard and per-document context bounds while treating canonical conflict pairs as atomic evidence units. */
export function selectConflictAwareCoverageEvidence(
  lanes: readonly CoverageBudgetLane[],
  options: { limit: number; maxPerDocument: number },
) {
  let units: CoverageBudgetUnit[] = [];
  const omittedConflictSubquestionIds = new Set<string>();
  const selectedResults = () => units.flatMap((unit) => unit.results);
  const selectedIds = () => new Set(selectedResults().map((result) => result.id));
  const documentCount = (documentId: string) =>
    selectedResults().filter((result) => result.document_id === documentId).length;
  const removeLastSingleton = (documentId?: string, protectedIds = new Set<string>()) => {
    const index = units.findLastIndex(
      (unit) =>
        !unit.conflict &&
        unit.results.length === 1 &&
        !protectedIds.has(unit.results[0]!.id) &&
        (!documentId || unit.results[0]!.document_id === documentId),
    );
    if (index < 0) return false;
    units = units.filter((_, unitIndex) => unitIndex !== index);
    return true;
  };
  const addConflictPair = (pair: SearchResult[], subquestionId: string) => {
    const snapshot = units.map((unit) => ({ ...unit, results: [...unit.results] }));
    const pairIds = new Set(pair.map((result) => result.id));
    units = units.map((unit) =>
      unit.results.some((result) => pairIds.has(result.id)) ? { ...unit, conflict: true } : unit,
    );
    const existingIds = selectedIds();
    const missingPair = pair.filter(
      (result, index) => !existingIds.has(result.id) && pair.findIndex((item) => item.id === result.id) === index,
    );
    const missingByDocument = new Map<string, number>();
    for (const result of missingPair) {
      missingByDocument.set(result.document_id, (missingByDocument.get(result.document_id) ?? 0) + 1);
    }
    for (const [documentId, missingCount] of missingByDocument) {
      while (documentCount(documentId) + missingCount > options.maxPerDocument) {
        if (!removeLastSingleton(documentId, pairIds)) {
          units = snapshot;
          omittedConflictSubquestionIds.add(subquestionId);
          return;
        }
      }
    }
    while (selectedResults().length + missingPair.length > options.limit) {
      if (!removeLastSingleton(undefined, pairIds)) {
        units = snapshot;
        omittedConflictSubquestionIds.add(subquestionId);
        return;
      }
    }
    if (missingPair.length) units.push({ results: missingPair, conflict: true });
  };
  const maxDepth = Math.max(0, ...lanes.map((lane) => lane.orderedEvidence.length));
  for (let depth = 0; depth < maxDepth; depth += 1) {
    for (const lane of lanes) {
      const result = lane.orderedEvidence[depth];
      if (!result || selectedIds().has(result.id)) continue;
      const conflictPair = conflictPairForEvidence(lane, result.id);
      if (conflictPair) {
        addConflictPair(conflictPair, lane.subquestionId);
      } else if (
        selectedResults().length < options.limit &&
        documentCount(result.document_id) < options.maxPerDocument
      ) {
        units.push({ results: [result], conflict: false });
      }
    }
  }
  return { results: selectedResults(), omittedConflictSubquestionIds };
}

/** Merge eligible evidence in policy order without numeric authority or locality score boosts. */
export function mergeEvidenceByCoverageAndSourceRole(input: CoverageMergeInput): CoverageEvidenceSelection[] {
  const indexed = input.candidates.map((result, inputIndex) => ({ result, inputIndex }));
  return input.plan.subquestions.map((subquestion) => {
    const relevanceQuery = coverageQueryForSubquestion(input.plan, subquestion);
    const claimRole =
      input.claimRole ??
      (relevanceQuery !== subquestion.question &&
      subquestion.requestedFacets?.length === 1 &&
      subquestion.requestedFacets[0] === "service_workflow"
        ? "service_workflow"
        : claimRoleForSubquestion(input, { ...subquestion, question: relevanceQuery }));
    let roleMismatch = false;
    const eligible = indexed.flatMap((candidate) => {
      const decision = eligibilityForCandidate({
        input,
        question: relevanceQuery,
        claimRole,
        result: candidate.result,
      });
      roleMismatch ||= decision.roleMismatch;
      return decision.eligible ? [annotateSubquestionRelevance(relevanceQuery, candidate)] : [];
    });
    const relevant = eligible.filter(({ result }) => relevanceRank(result) < 2);
    const { ordered, conflicts, sourcePolicyReview } = orderedByPolicy({
      input,
      question: relevanceQuery,
      candidates: relevant,
      claimRole,
    });
    const collapsed = collapseEvidenceFamilies(ordered, conflicts);
    const eligibleProductRecordIds = new Set(
      collapsed.orderedEvidence.flatMap((result) => {
        const metadata = normalizeClinicalSourceMetadata(result.source_metadata);
        return productIntent(input.plan, relevanceQuery, result) && metadata.source_kind === "registry_record"
          ? [result.id]
          : [];
      }),
    );
    const australianBounded = selectAustralianClinicalContext(collapsed.orderedEvidence, {
      limit: collapsed.orderedEvidence.length,
      maxPerDocument: collapsed.orderedEvidence.length,
      sufficientAustralianChunks: 4,
      omitSupplementaryPadding: true,
      preserveInputPolicyOrder: true,
    });
    const australianBoundedIds = new Set(australianBounded.map((result) => result.id));
    const supplementaryBounded = collapsed.orderedEvidence.filter(
      (result) => australianBoundedIds.has(result.id) || eligibleProductRecordIds.has(result.id),
    );
    const preliminaryBudget = selectConflictAwareCoverageEvidence(
      [{ subquestionId: subquestion.id, orderedEvidence: supplementaryBounded, conflicts }],
      { limit: input.maxPerSubquestion ?? 6, maxPerDocument: input.maxPerDocument ?? 2 },
    );
    const orderedEvidence = preliminaryBudget.results;
    const direct = orderedEvidence.some((result) => result.relevance?.verdict === "direct");
    const partial = orderedEvidence.some((result) => result.relevance?.verdict === "partial");
    const coverageReason: CoverageEvidenceSelection["coverageReason"] = direct
      ? "direct"
      : partial
        ? "partial"
        : roleMismatch
          ? "source_role_mismatch"
          : input.siteContentState === "updating"
            ? "site_content_updating"
            : input.siteContentState === "stale"
              ? "site_content_stale"
              : "not_in_corpus";
    return {
      subquestionId: subquestion.id,
      claimRole,
      orderedEvidence,
      collapsedEvidenceFamilyIds: collapsed.collapsedEvidenceFamilyIds,
      conflicts: retainedSelectionConflicts(conflicts, orderedEvidence),
      sourcePolicyReview,
      sourcePolicyConflictOmitted: preliminaryBudget.omittedConflictSubquestionIds.has(subquestion.id),
      coverageReason,
    };
  });
}

export function answerCoverageFromSelections(args: {
  plan: RagQueryPlan;
  selectedEvidence: readonly SearchResult[];
  selections: readonly CoverageEvidenceSelection[];
  citedChunkIds?: readonly string[];
}) {
  const cited = new Set(args.citedChunkIds ?? args.selectedEvidence.map((result) => result.id));
  return evaluateAnswerCoverage({
    plan: args.plan,
    selectedEvidence: args.selectedEvidence,
    evidenceBySubquestion: args.selections.map((selection) => {
      const incompletelyCitedConflict = selection.conflicts.some((conflict) => {
        const citesLocal = conflict.local.supportingChunkIds.some((id) => cited.has(id));
        const citesAustralian = conflict.australian.supportingChunkIds.some((id) => cited.has(id));
        return citesLocal !== citesAustralian;
      });
      return {
        subquestionId: selection.subquestionId,
        selectedChunkIds: selection.orderedEvidence.map((result) => result.id),
        citedChunkIds: selection.orderedEvidence.map((result) => result.id).filter((id) => cited.has(id)),
        eligibleChunkIds: selection.orderedEvidence.map((result) => result.id),
        support: selection.coverageReason === "direct" ? "direct" : "partial",
        reasonCodes: [
          selection.coverageReason,
          ...(selection.sourcePolicyReview === "not_evaluated" ||
          selection.sourcePolicyConflictOmitted ||
          incompletelyCitedConflict
            ? ["source_policy_not_evaluated"]
            : []),
        ],
        insufficiencyReason:
          selection.coverageReason === "direct" || selection.coverageReason === "partial"
            ? null
            : selection.coverageReason,
      };
    }),
    conflicts: args.selections.flatMap((selection) => selection.conflicts),
  });
}

/** Replace provisional policy-conflict flags with the post-citation request-local verdict. */
export function reconcileAnswerSourcePolicyConflicts(
  answer: RagAnswer,
  selections: readonly CoverageEvidenceSelection[],
  coveragePlan: AnswerCoveragePlan | null,
) {
  if (coveragePlan?.insufficiencyReason) {
    const coverageCode = classifyRagFallbackReason({ insufficiencyReason: coveragePlan.insufficiencyReason });
    if (
      !answer.fallbackReasonCode ||
      (isStrongerGovernanceFallbackReasonCode(coverageCode) &&
        !isStrongerGovernanceFallbackReasonCode(answer.fallbackReasonCode))
    ) {
      answer.fallbackReasonCode = coverageCode;
    }
  }
  if (coveragePlan) {
    const required = coveragePlan.subquestions.filter((part) => part.required);
    const represented = required.filter((part) =>
      coveragePlan.coverage.some(
        (entry) => entry.subquestionId === part.id && entry.status !== "absent" && entry.chunkIds.length > 0,
      ),
    );
    const counts = { direct: 0, partial: 0, conflicting: 0, absent: 0 };
    for (const entry of coveragePlan.coverage) counts[entry.status] += 1;
    answer.ragDiagnostics = sanitizeRagEvalDiagnostics({
      ...answer.ragDiagnostics,
      required_part_count: required.length,
      represented_part_count: represented.length,
      coverage_counts: counts,
    });
  }
  const candidateConflicts = selections.flatMap((selection) => selection.conflicts);
  const nonPolicyFlags = (answer.conflictsOrGaps ?? []).filter(
    (item) =>
      item.type !== "conflict" ||
      !candidateConflicts.some((conflict) => {
        const itemIds = new Set(item.source_chunk_ids ?? []);
        if (itemIds.size === 0) return false;
        const conflictIds = new Set([...conflict.local.supportingChunkIds, ...conflict.australian.supportingChunkIds]);
        return [...itemIds].every((id) => conflictIds.has(id));
      }),
  );
  const finalCitedChunkIds = new Set((coveragePlan?.coverage ?? []).flatMap((item) => item.chunkIds));
  const retainedPolicyFlags = (coveragePlan?.conflicts ?? []).slice(0, 4).flatMap((conflict) => {
    const localIds = conflict.local.supportingChunkIds.filter((id) => finalCitedChunkIds.has(id));
    const australianIds = conflict.australian.supportingChunkIds.filter((id) => finalCitedChunkIds.has(id));
    if (!localIds.length || !australianIds.length) return [];
    const sourceChunkIds = [localIds[0], australianIds[0], ...localIds.slice(1), ...australianIds.slice(1)].filter(
      (id): id is string => Boolean(id),
    );
    return [
      {
        type: "conflict" as const,
        message: `Current local-primary and Australian sources have a reviewed ${conflict.materialDifferenceReason.replaceAll("_", " ")} difference. Review the local-primary source before acting.`,
        source_chunk_ids: [...new Set(sourceChunkIds)].slice(0, 4),
      },
    ];
  });
  const unevaluatedCoverage = (coveragePlan?.coverage ?? []).filter((item) =>
    item.reasonCodes.includes("source_policy_not_evaluated"),
  );
  const reviewGap = unevaluatedCoverage.length
    ? [
        {
          type: "gap" as const,
          message:
            "Directly relevant local and Australian evidence was found, but their source-policy relationship was either not canonically reviewed or not completely represented by the final citations.",
          source_chunk_ids: [...new Set(unevaluatedCoverage.flatMap((item) => item.chunkIds))].slice(0, 4),
        },
      ]
    : [];
  answer.conflictsOrGaps = [...nonPolicyFlags, ...retainedPolicyFlags, ...reviewGap];
}

function boundedPromptToken(value: string, maxLength = 64) {
  const bounded = value.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, maxLength);
  return bounded || "unknown";
}

/** Content-free prompt projection: IDs, statuses and reason codes only. */
export function formatAnswerCoveragePromptLine(plan: AnswerCoveragePlan) {
  const items = plan.coverage.slice(0, 4).map((item) => {
    const reasons = item.reasonCodes
      .slice(0, 4)
      .map((reason) => boundedPromptToken(reason, 48))
      .join(",");
    return `${boundedPromptToken(item.subquestionId)}:${item.status}:${reasons || "none"}`;
  });
  return `answer_plan.coverage: overall=${plan.overall}; items=${items.join("|") || "none"}; insufficiency=${boundedPromptToken(plan.insufficiencyReason ?? "none")}`;
}

export type AdaptiveCoverageBehavior =
  "full_synthesis" | "bounded_partial_synthesis" | "source_gap_only" | "verified_conflict_review";

export type InternalAdaptiveAnswerPlan = SmartRagAnswerPlan & {
  answerCoverage: AnswerCoveragePlan;
  coverageBehavior: AdaptiveCoverageBehavior;
  sourcePolicyReview: "none" | "not_evaluated" | "verified_conflict";
};

/** Consume the full request-local coverage object without attaching it to the public/cached API plan. */
export function adaptSmartAnswerPlanForCoverage(
  basePlan: SmartRagAnswerPlan,
  answerCoverage: AnswerCoveragePlan,
): InternalAdaptiveAnswerPlan {
  const sourcePolicyReview = answerCoverage.conflicts.length
    ? "verified_conflict"
    : answerCoverage.coverage.some((item) => item.reasonCodes.includes("source_policy_not_evaluated"))
      ? "not_evaluated"
      : "none";
  const coverageBehavior: AdaptiveCoverageBehavior = answerCoverage.conflicts.length
    ? "verified_conflict_review"
    : answerCoverage.overall === "absent"
      ? "source_gap_only"
      : answerCoverage.overall === "partial"
        ? "bounded_partial_synthesis"
        : "full_synthesis";
  const adaptiveCriteria =
    coverageBehavior === "verified_conflict_review"
      ? ["preserve_local_primary_source", "surface_verified_source_conflict", "require_source_review"]
      : coverageBehavior === "source_gap_only"
        ? ["report_source_gap_only", "do_not_generate_clinical_advice"]
        : coverageBehavior === "bounded_partial_synthesis"
          ? ["omit_uncovered_subquestions", "surface_source_gaps"]
          : [];
  if (sourcePolicyReview === "not_evaluated") {
    adaptiveCriteria.push("do_not_claim_source_agreement", "require_source_policy_review");
  }
  return {
    ...basePlan,
    retrievalQuality:
      coverageBehavior === "verified_conflict_review"
        ? "conflicting"
        : coverageBehavior === "source_gap_only"
          ? "weak"
          : coverageBehavior === "bounded_partial_synthesis"
            ? "partial"
            : basePlan.retrievalQuality,
    qualityCriteria: [...new Set([...basePlan.qualityCriteria, ...adaptiveCriteria])],
    fallbackBehavior: coverageBehavior === "full_synthesis" ? basePlan.fallbackBehavior : "source_gap",
    answerCoverage,
    coverageBehavior,
    sourcePolicyReview,
  };
}

function subquestionCandidateStatus(
  plan: RagQueryPlan,
  subquestion: RagQueryPlan["subquestions"][number],
  selectedEvidence: readonly SearchResult[],
) {
  const claimRole = classifyClaimRoleForSubquestion(subquestion);
  const knownScopeCandidates = selectedEvidence.filter(candidateHasKnownServerScope);
  const [selection] = mergeEvidenceByCoverageAndSourceRole({
    plan: { ...plan, subquestions: [subquestion] },
    candidates: knownScopeCandidates,
    claimRole,
    maxPerSubquestion: Math.max(1, knownScopeCandidates.length),
    maxPerDocument: Math.max(1, knownScopeCandidates.length),
  });
  const candidates = (selection?.orderedEvidence ?? [])
    .map((candidate) => {
      const candidateForSubquestion = { ...candidate };
      delete candidateForSubquestion.relevance;
      return candidateForSubquestion;
    })
    .filter((candidate) => buildEvidenceRelevance(subquestion.question, [candidate]).isSourceBacked);
  if (candidates.length === 0) return "absent" as const;

  const relevance = buildEvidenceRelevance(subquestion.question, candidates);
  const gate = evaluateEvidenceCoverageGate(subquestion.question, candidates);
  if (gate.reason !== "coverage_gate_not_applicable" && !gate.accepted) return "absent" as const;
  if (relevance.verdict === "direct") return "matched" as const;
  if (relevance.verdict === "partial") return "partial_match" as const;
  return "absent" as const;
}

/** Candidate variants are spent only on required subquestions that remain below direct coverage. */
export function uncoveredRagSubquestions(plan: RagQueryPlan, selectedEvidence: readonly SearchResult[]) {
  return plan.subquestions.filter(
    (subquestion) =>
      subquestion.required && subquestionCandidateStatus(plan, subquestion, selectedEvidence) !== "matched",
  );
}

export function evaluateShadowCandidateMatchCounts(
  plan: RagQueryPlan,
  selectedEvidence: readonly SearchResult[],
): RagCandidateMatchCounts {
  return plan.subquestions.reduce<RagCandidateMatchCounts>(
    (counts, subquestion) => {
      const status = subquestionCandidateStatus(plan, subquestion, selectedEvidence);
      return { ...counts, [status]: counts[status] + 1 };
    },
    { matched: 0, partial_match: 0, absent: 0 },
  );
}

function candidateHasKnownServerScope(result: SearchResult) {
  if (!knownCorpusScopes.has(result.corpus_scope as SourceCorpusScope)) return false;
  const hasKnownSiteDomain = knownSiteDomains.has(result.site_content_domain as SiteContentDomain);
  if (result.corpus_scope === "clinical_kb_site" ? !hasKnownSiteDomain : result.site_content_domain != null)
    return false;
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
  coverage: AnswerCoveragePlan["coverage"],
): RagInsufficiencyReason | null {
  if (overall === "complete") return null;
  if (overall === "conflicting") return "source_conflict";
  if (
    coverage.some((item) => item.reasonCodes.includes("candidate_scope_rejected")) ||
    input.evidenceBySubquestion.some((item) => item.reasonCodes?.includes("source_governance_block"))
  )
    return "governance_block";
  const selectedReason = input.evidenceBySubquestion.find((item) => item.insufficiencyReason)?.insufficiencyReason;
  const explicitReason = input.insufficiencyReason ?? selectedReason;
  const hasCandidateEvidence =
    input.selectedEvidence.length > 0 ||
    input.evidenceBySubquestion.some(
      (item) => item.selectedChunkIds.length > 0 || item.citedChunkIds.length > 0 || item.eligibleChunkIds?.length > 0,
    );
  const hasMissingDecision = coverage.some((item) =>
    item.reasonCodes.some((reason) =>
      ["eligibility_decision_missing", "direct_support_decision_missing"].includes(reason),
    ),
  );
  if (explicitReason === "not_in_corpus" && (hasCandidateEvidence || hasMissingDecision)) {
    return "insufficient_claim_support";
  }
  if (explicitReason) return explicitReason;
  return "insufficient_claim_support";
}

export function evaluateAnswerCoverage(input: EvaluateAnswerCoverageInput): AnswerCoveragePlan {
  const evidenceById = new Map(input.selectedEvidence.map((result) => [result.id, result]));
  const selectionBySubquestion = new Map(input.evidenceBySubquestion.map((item) => [item.subquestionId, item]));
  const allDirectIds = new Set<string>();

  const coverage: AnswerCoveragePlan["coverage"] = input.plan.subquestions.map((subquestion) => {
    const selection = selectionBySubquestion.get(subquestion.id);
    const selectedIds = new Set(selection?.selectedChunkIds ?? []);
    const citedIds = new Set(selection?.citedChunkIds ?? []);
    const eligibilityDecisionMissing = !selection || !Array.isArray(selection.eligibleChunkIds);
    const supportDecisionMissing = !selection || (selection.support !== "direct" && selection.support !== "partial");
    const eligibleIds = eligibilityDecisionMissing ? new Set<string>() : new Set(selection.eligibleChunkIds);
    let rejectedScope = false;
    const directEvidence = [...selectedIds].flatMap((id) => {
      if (!citedIds.has(id) || !eligibleIds.has(id)) return [];
      const result = evidenceById.get(id);
      if (!result) return [];
      if (!candidateHasKnownServerScope(result)) {
        rejectedScope = true;
        return [];
      }
      return [result];
    });
    const gate = evaluateEvidenceCoverageGate(subquestion.question, directEvidence);
    const queryClass = classifyRagQuery(subquestion.question).queryClass;
    const doseIntent = medicationDoseEvidenceQueryIntent(subquestion.question);
    const gateApplies =
      gate.reason !== "coverage_gate_not_applicable" &&
      !(
        queryClass === "medication_dose_risk" &&
        !doseIntent.asksAmount &&
        !doseIntent.asksRoute &&
        !doseIntent.asksFrequency
      );
    const supportedEvidence = (gateApplies && !gate.accepted) || supportDecisionMissing ? [] : directEvidence;
    for (const result of supportedEvidence) allDirectIds.add(result.id);
    const reasonCodes = [
      ...(selection?.reasonCodes ?? []),
      `evidence_gate:${gate.reason}`,
      ...(rejectedScope ? ["candidate_scope_rejected"] : []),
      ...(eligibilityDecisionMissing ? ["eligibility_decision_missing"] : []),
      ...(supportDecisionMissing ? ["direct_support_decision_missing"] : []),
    ];
    const status: AnswerCoveragePlan["coverage"][number]["status"] =
      supportedEvidence.length === 0 || supportDecisionMissing
        ? "absent"
        : selection.support === "partial"
          ? "partial"
          : "direct";
    return {
      subquestionId: subquestion.id,
      status,
      chunkIds: supportedEvidence.map((result) => result.id),
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

  // A compound primary answer can compose independent, role-checked facets.
  // This is coverage of the request, never authority for one row to answer every facet.
  const primary = input.plan.subquestions.find((part) => part.question === input.plan.originalQuery && part.required);
  const primaryCoverage = coverage.find((entry) => entry.subquestionId === primary?.id);
  if (primary?.requestedFacets?.length && primary.requestedFacets.length > 1 && primaryCoverage && !conflicts.length) {
    const independent = input.plan.subquestions.filter(
      (part) =>
        part.required && part.id !== primary.id && coverageQueryForSubquestion(input.plan, part) !== part.question,
    );
    const coveredFacets = new Set(independent.flatMap((part) => part.requestedFacets ?? []));
    const completePartition =
      coveredFacets.size === primary.requestedFacets.length &&
      primary.requestedFacets.every((facet) => coveredFacets.has(facet)) &&
      independent.every((part) =>
        coverage.some(
          (entry) =>
            entry.subquestionId === part.id &&
            entry.status === "direct" &&
            entry.chunkIds.length > 0 &&
            !entry.reasonCodes.includes("source_policy_not_evaluated"),
        ),
      );
    if (completePartition) {
      primaryCoverage.status = "direct";
      primaryCoverage.chunkIds = [
        ...new Set(
          independent.flatMap((part) => coverage.find((entry) => entry.subquestionId === part.id)?.chunkIds ?? []),
        ),
      ];
      primaryCoverage.reasonCodes = ["composed_from_direct_facet_coverage"];
    }
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
    insufficiencyReason: inferredInsufficiencyReason(input, overall, coverage),
  };
}
