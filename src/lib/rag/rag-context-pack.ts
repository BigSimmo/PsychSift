import { estimateTokens } from "@/lib/chunking";
import { createHash } from "node:crypto";

import { retrievalAccessScopeKey, type RetrievalAccessScope } from "@/lib/owner-scope";
import { hasClinicalValueOrSchedule } from "@/lib/answer-verification";
import { buildCrossDocumentFusionBrief } from "@/lib/cross-document-synthesis";
import { contextPackAdmissionMatches } from "@/lib/rag/rag-context-admission";
import { hasClinicalActionSignal, hasClinicalPopulationSignal } from "@/lib/rag/rag-clinical-language-signals";
import { ragContextSnapshotCacheKey } from "@/lib/rag/rag-context-snapshot";
import type { ModelContextEvidenceSelection } from "@/lib/rag/rag-context-selection";
import {
  answerCoverageFromSelections,
  conflictPairForEvidence,
  evidenceFamilyIdsForResult,
  type CoverageEvidenceSelection,
} from "@/lib/rag/rag-coverage";
import {
  recheckCheckedPublishedOriginalSectionLayout,
  type CheckedPublishedOriginalSectionLayout,
  buildRagSourceBlock,
  buildPackedRagSourceBlock,
  compactContextText,
  estimatePackedRagSourceBlockTokens,
  ragSerializedClinicalEvidenceText,
  ragSourceSerializationPreservesAtomicEvidence,
  ragTableSnippetTextForFact,
} from "@/lib/rag/rag-source-block";
import { committedIndexGeneration } from "@/lib/reindex-pipeline";
import { searchResultEligibilityForClaim, sourceRoleEligibleForClaim } from "@/lib/source-role-policy";
import type { RagContextSnapshot } from "@/lib/site-content/site-content-contracts";
import type { createAdminClient } from "@/lib/supabase/admin";
import type {
  AnswerCoveragePlan,
  ClinicalClaimRole,
  RagQueryClass,
  SearchResult,
  SourceCorpusScope,
} from "@/lib/types";

export const ragContextPackVersion = "rag-context-pack-v1";

export type PackedEvidenceGroup = {
  id: string;
  subquestionIds: string[];
  required: boolean;
  claimRole: ClinicalClaimRole;
  evidenceFamilyIds: string[];
  corpusScope: SourceCorpusScope;
  accessIdentity: string;
  generationIdentity: string;
  releaseIdentity: string;
  admissionUnitId?: string;
  members: SearchResult[];
  atomicFeatures: {
    hasPopulation: boolean;
    hasException: boolean;
    hasAction: boolean;
    hasUnitsOrQualifier: boolean;
    hasStructuredTableContext: boolean;
  };
};

export type ClaimOrientedContextPack = {
  packId: string;
  groups: PackedEvidenceGroup[];
  usedTokens: number;
  omittedOptionalGroupIds: string[];
};

export type ClaimOrientedContextPackInput = {
  selections: CoverageEvidenceSelection[];
  coverage: AnswerCoveragePlan;
  tokenBudget: number;
  queryClass?: RagQueryClass;
  planVersion?: string;
  snapshot: RagContextSnapshot;
  accessScope: RetrievalAccessScope;
};

const knownCorpusScopes = new Set<SourceCorpusScope>([
  "uploaded_local",
  "clinical_kb_site",
  "australian_public",
  "international_supplementary",
]);
const knownSiteDomains = new Set([
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
const exceptionPattern =
  /\b(?:except|unless|however|but|instead|contraindicat(?:e|es|ed|ion|ions)|do not|must not|avoid|withhold)\b/i;
const unitOrQualifierPattern =
  /\b(?:\d+(?:\.\d+)?\s*(?:mg|mcg|microg|g|kg|mL|L|IU|units?|mmol|%|x10\^?\d+\/L)|daily|nightly|weekly|hourly|maximum|minimum|above|below|at least|no more than)\b/i;
const packedGroupsByResultSet = new WeakMap<SearchResult[], PackedEvidenceGroup[]>();

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function legacyStableHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function resultIdentity(result: SearchResult) {
  const receipt = result.context_pack_admission;
  const ownerId = receipt?.ownerId ?? null;
  return {
    accessIdentity: ownerId ? `owner:${stableHash(ownerId).slice(0, 16)}` : "public",
    generationIdentity: receipt?.indexGeneration ?? "no-document-generation",
    releaseIdentity: receipt?.siteContent
      ? `${receipt.siteContent.releaseId}:${receipt.siteContent.releaseDigest}:${receipt.siteContent.changeEpoch}`
      : "no-site-release",
  };
}

function sanitizeStructuredTableFacts(result: SearchResult): SearchResult {
  if (!result.table_facts?.length) return result;
  const tableFacts = result.table_facts.filter(
    (fact) =>
      Boolean(fact.row_label?.trim()) &&
      Boolean(fact.clinical_parameter?.trim()) &&
      Boolean(fact.threshold_value?.trim() || fact.action?.trim() || ragTableSnippetTextForFact(result, fact)),
  );
  return tableFacts.length === result.table_facts.length ? result : { ...result, table_facts: tableFacts };
}

function eligibleResult(
  result: SearchResult,
  claimRole: ClinicalClaimRole,
  expected: Pick<ClaimOrientedContextPackInput, "accessScope" | "snapshot">,
) {
  if (!knownCorpusScopes.has(result.corpus_scope as SourceCorpusScope)) return false;
  if (
    result.corpus_scope === "clinical_kb_site"
      ? !knownSiteDomains.has(result.site_content_domain ?? "")
      : result.site_content_domain != null
  )
    return false;
  if (result.source_metadata?.corpus_scope !== result.corpus_scope) return false;
  if (!contextPackAdmissionMatches(result, expected.accessScope, expected.snapshot)) return false;
  if (result.source_metadata?.source_kind === "registry_record") {
    return (
      result.corpus_scope === "clinical_kb_site" &&
      result.source_metadata.content_mode === "indexed_content" &&
      result.source_metadata.document_status === "current" &&
      (result.source_metadata.clinical_validation_status === "approved" ||
        result.source_metadata.clinical_validation_status === "locally_reviewed") &&
      result.source_metadata.extraction_quality === "good" &&
      sourceRoleEligibleForClaim(result.source_metadata.source_role, claimRole)
    );
  }
  return searchResultEligibilityForClaim(result, claimRole).eligible;
}

function atomicFeatures(members: readonly SearchResult[]) {
  const text = members.map(ragSerializedClinicalEvidenceText).join(" ");
  return {
    hasPopulation: hasClinicalPopulationSignal(text),
    hasException: exceptionPattern.test(text),
    hasAction: hasClinicalActionSignal(text),
    hasUnitsOrQualifier: unitOrQualifierPattern.test(text) || hasClinicalValueOrSchedule(text),
    hasStructuredTableContext: members.some((member) => Boolean(member.table_facts?.length)),
  };
}

function groupIdPayload(group: Omit<PackedEvidenceGroup, "id" | "atomicFeatures">) {
  return {
    version: ragContextPackVersion,
    subquestionIds: [...group.subquestionIds].sort(),
    required: group.required,
    claimRole: group.claimRole,
    evidenceFamilyIds: [...group.evidenceFamilyIds].sort(),
    corpusScope: group.corpusScope,
    accessIdentity: group.accessIdentity,
    generationIdentity: group.generationIdentity,
    releaseIdentity: group.releaseIdentity,
    admissionUnitId: group.admissionUnitId ?? null,
    members: group.members.map((member) => ({
      id: member.id,
      documentId: member.document_id,
      chunkIndex: member.chunk_index,
      pageNumber: member.page_number,
      role: member.source_metadata?.source_role ?? null,
      currentness: member.source_metadata?.document_status ?? null,
      serializedInputHash: stableHash(
        buildPackedRagSourceBlock([{ ...group, id: "", atomicFeatures: atomicFeatures([member]), members: [member] }]),
      ),
    })),
  };
}

function coalesceAdjacentGroups(groups: PackedEvidenceGroup[]) {
  const ordinary = groups
    .map((group, encounter) => ({ group, encounter }))
    .filter(({ group }) => !group.admissionUnitId);
  const buckets = new Map<string, typeof ordinary>();
  for (const item of ordinary) {
    const first = item.group.members[0];
    if (!first) continue;
    const key = JSON.stringify([
      item.group.claimRole,
      item.group.corpusScope,
      item.group.accessIdentity,
      item.group.generationIdentity,
      item.group.releaseIdentity,
      first.document_id,
    ]);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  const replacements = new Map<PackedEvidenceGroup, { encounter: number; group: PackedEvidenceGroup }>();
  const consumed = new Set<PackedEvidenceGroup>();
  for (const bucket of buckets.values()) {
    const sorted = [...bucket].sort(
      (left, right) =>
        (left.group.members[0]?.chunk_index ?? 0) - (right.group.members[0]?.chunk_index ?? 0) ||
        left.encounter - right.encounter ||
        left.group.id.localeCompare(right.group.id),
    );
    let component: typeof sorted = [];
    const flush = () => {
      if (component.length < 2) {
        component = [];
        return;
      }
      const firstEncounter = Math.min(...component.map(({ encounter }) => encounter));
      const merged = refreshGroup({
        ...component[0].group,
        subquestionIds: component.flatMap(({ group }) => group.subquestionIds),
        required: component.some(({ group }) => group.required),
        evidenceFamilyIds: component.flatMap(({ group }) => group.evidenceFamilyIds),
        members: component.flatMap(({ group }) => group.members),
      });
      replacements.set(component[0].group, { encounter: firstEncounter, group: merged });
      component.slice(1).forEach(({ group }) => consumed.add(group));
      component = [];
    };
    for (const item of sorted) {
      const previous = component[component.length - 1]?.group.members.at(-1);
      const current = item.group.members[0];
      if (previous && current && current.chunk_index - previous.chunk_index !== 1) flush();
      component.push(item);
    }
    flush();
  }
  return groups
    .flatMap((group, encounter) => {
      if (consumed.has(group)) return [];
      const replacement = replacements.get(group);
      return [{ encounter: replacement?.encounter ?? encounter, group: replacement?.group ?? group }];
    })
    .sort((left, right) => left.encounter - right.encounter)
    .map(({ group }) => group);
}

function refreshGroup(group: PackedEvidenceGroup): PackedEvidenceGroup {
  const withoutDerived = {
    subquestionIds: [...new Set(group.subquestionIds)],
    required: group.required,
    claimRole: group.claimRole,
    evidenceFamilyIds: [...new Set(group.evidenceFamilyIds)],
    corpusScope: group.corpusScope,
    accessIdentity: group.accessIdentity,
    generationIdentity: group.generationIdentity,
    releaseIdentity: group.releaseIdentity,
    admissionUnitId: group.admissionUnitId,
    members: group.members,
  };
  return {
    ...withoutDerived,
    id: `pack-group:${stableHash(groupIdPayload(withoutDerived)).slice(0, 32)}`,
    atomicFeatures: atomicFeatures(group.members),
  };
}

export function contextPackTokenCeiling(queryClass: RagQueryClass, options: { crossDocument?: boolean } = {}) {
  if (options.crossDocument || queryClass === "comparison" || queryClass === "broad_summary") return 6_500;
  if (queryClass === "medication_dose_risk" || queryClass === "table_threshold") return 4_800;
  return queryClass === "document_lookup" ? 4_200 : 3_600;
}

export function packClaimOrientedContext(input: ClaimOrientedContextPackInput): ClaimOrientedContextPack {
  const requiredBySubquestion = new Map(input.coverage.subquestions.map((item) => [item.id, item.required] as const));
  const groups: PackedEvidenceGroup[] = [];
  const groupByDedupeKey = new Map<string, PackedEvidenceGroup>();

  for (const selection of input.selections) {
    for (const rawResult of selection.orderedEvidence) {
      if (!eligibleResult(rawResult, selection.claimRole, input)) continue;
      const result = sanitizeStructuredTableFacts(rawResult);
      const evidenceFamilyIds = evidenceFamilyIdsForResult(result);
      const conflictPair = conflictPairForEvidence(selection, result.id);
      const conflict = conflictPair
        ? selection.conflicts.find((candidate) =>
            [...candidate.local.supportingChunkIds, ...candidate.australian.supportingChunkIds].includes(result.id),
          )
        : null;
      const admissionUnitId = conflict ? `conflict:${conflict.id}` : undefined;
      const dedupeKey = admissionUnitId
        ? `${admissionUnitId}:result:${result.id}`
        : `${selection.claimRole}:${[...evidenceFamilyIds].sort().join("|")}`;
      const duplicate = groupByDedupeKey.get(dedupeKey);
      if (duplicate) {
        duplicate.subquestionIds.push(selection.subquestionId);
        duplicate.required ||= requiredBySubquestion.get(selection.subquestionId) === true;
        continue;
      }
      const identity = resultIdentity(result);
      const group = refreshGroup({
        id: "",
        subquestionIds: [selection.subquestionId],
        required: requiredBySubquestion.get(selection.subquestionId) === true,
        claimRole: selection.claimRole,
        evidenceFamilyIds,
        corpusScope: result.corpus_scope!,
        ...identity,
        admissionUnitId,
        members: [result],
        atomicFeatures: atomicFeatures([result]),
      });
      groups.push(group);
      groupByDedupeKey.set(dedupeKey, group);
    }
  }

  const candidates = groups.map(refreshGroup);
  const units: PackedEvidenceGroup[][] = [];
  const admissionGroupsById = new Map<string, PackedEvidenceGroup[]>();
  for (const candidate of candidates) {
    const unitId = candidate.admissionUnitId ?? candidate.id;
    const unit = admissionGroupsById.get(unitId);
    if (unit) unit.push(candidate);
    else {
      const created = [candidate];
      admissionGroupsById.set(unitId, created);
      units.push(created);
    }
  }
  const selected: PackedEvidenceGroup[] = [];
  const selectedIds = new Set<string>();
  const omittedIds = new Set<string>();
  const tryAdd = (unit: PackedEvidenceGroup[], firstAllocationCeiling?: number) => {
    const missing = unit.filter((group) => !selectedIds.has(group.id));
    if (!missing.length) return true;
    if (unit[0]?.admissionUnitId && unit.length !== 2) {
      unit.forEach((group) => omittedIds.add(group.id));
      return false;
    }
    const truncationSensitive = unit.some(
      (group) =>
        group.atomicFeatures.hasPopulation ||
        group.atomicFeatures.hasException ||
        group.atomicFeatures.hasAction ||
        group.atomicFeatures.hasUnitsOrQualifier ||
        group.atomicFeatures.hasStructuredTableContext ||
        group.members.some((member) => hasClinicalValueOrSchedule(ragSerializedClinicalEvidenceText(member))),
    );
    if (
      truncationSensitive &&
      unit.some((group) =>
        group.members.some(
          (member) => !ragSourceSerializationPreservesAtomicEvidence(member, { queryClass: input.queryClass }),
        ),
      )
    ) {
      unit.forEach((group) => omittedIds.add(group.id));
      return false;
    }
    if (
      firstAllocationCeiling !== undefined &&
      estimatePackedRagSourceBlockTokens(coalesceAdjacentGroups(missing), { queryClass: input.queryClass }) >
        firstAllocationCeiling
    ) {
      unit.forEach((group) => omittedIds.add(group.id));
      return false;
    }
    const trial = coalesceAdjacentGroups([...selected, ...missing]);
    if (estimatePackedRagSourceBlockTokens(trial, { queryClass: input.queryClass }) > Math.max(0, input.tokenBudget)) {
      unit.forEach((group) => omittedIds.add(group.id));
      return false;
    }
    selected.push(...missing);
    missing.forEach((group) => {
      selectedIds.add(group.id);
      omittedIds.delete(group.id);
    });
    return true;
  };

  const requiredSubquestions = input.coverage.subquestions.filter((subquestion) => subquestion.required);
  const firstAllocationCeiling = Math.floor(Math.max(0, input.tokenBudget) / Math.max(1, requiredSubquestions.length));
  for (const subquestion of requiredSubquestions) {
    if (selected.some((group) => group.subquestionIds.includes(subquestion.id))) continue;
    for (const unit of units.filter((candidate) =>
      candidate.some((group) => group.subquestionIds.includes(subquestion.id)),
    )) {
      if (tryAdd(unit, firstAllocationCeiling)) break;
    }
  }
  for (const unit of units) tryAdd(unit);

  const packedGroups = coalesceAdjacentGroups(selected);
  const usedTokens = packedGroups.length
    ? estimatePackedRagSourceBlockTokens(packedGroups, { queryClass: input.queryClass })
    : 0;
  const packId = `context-pack:${stableHash({
    version: ragContextPackVersion,
    budget: input.tokenBudget,
    queryClass: input.queryClass ?? "unknown",
    planVersion: input.planVersion ?? "unknown-plan",
    snapshotIdentity: ragContextSnapshotCacheKey(input.snapshot),
    accessScope: stableHash(retrievalAccessScopeKey(input.accessScope)),
    groupIds: packedGroups.map((group) => group.id),
    omittedGroupIds: [...omittedIds],
  }).slice(0, 32)}`;
  return { packId, groups: packedGroups, usedTokens, omittedOptionalGroupIds: [...omittedIds] };
}

export function packedEvidenceResults(pack: ClaimOrientedContextPack) {
  const seen = new Set<string>();
  const results = pack.groups.flatMap((group) =>
    group.members.filter((member) => {
      if (seen.has(member.id)) return false;
      seen.add(member.id);
      return true;
    }),
  );
  packedGroupsByResultSet.set(results, pack.groups);
  return results;
}

export type PackedModelContextEvidenceSelection = ModelContextEvidenceSelection & { results: SearchResult[] };

function reconcilePackedSelection(
  selection: ModelContextEvidenceSelection,
  results: SearchResult[],
): PackedModelContextEvidenceSelection {
  if (!selection.coverage || !selection.coverageSelections.length) return { ...selection, results };
  const retainedIds = new Set(results.map((result) => result.id));
  const coverageSelections = selection.coverageSelections.map((lane) => {
    const orderedEvidence = lane.orderedEvidence.filter((result) => retainedIds.has(result.id));
    const conflicts = lane.conflicts.filter(
      (conflict) =>
        conflict.local.supportingChunkIds.some((id) => retainedIds.has(id)) &&
        conflict.australian.supportingChunkIds.some((id) => retainedIds.has(id)),
    );
    const sourcePolicyConflictOmitted =
      lane.sourcePolicyConflictOmitted || (lane.conflicts.length > 0 && conflicts.length < lane.conflicts.length);
    return {
      ...lane,
      orderedEvidence,
      conflicts,
      sourcePolicyConflictOmitted,
      sourcePolicyReview: conflicts.length
        ? ("verified_conflict" as const)
        : sourcePolicyConflictOmitted || lane.sourcePolicyReview === "not_evaluated"
          ? ("not_evaluated" as const)
          : ("not_applicable" as const),
    };
  });
  return {
    ...selection,
    results,
    coverageSelections,
    coverage: selection.queryPlan
      ? answerCoverageFromSelections({
          plan: selection.queryPlan,
          selectedEvidence: results,
          selections: coverageSelections,
        })
      : selection.coverage,
  };
}

export function governedContextPackingApplies(selection: ModelContextEvidenceSelection) {
  return Boolean(selection.coverage && selection.coverageSelections.length);
}

/** Reconcile one governed selection to the exact pack before it can own response artifacts. */
export async function packModelContextEvidence(
  selection: ModelContextEvidenceSelection,
  pack: (selection: ModelContextEvidenceSelection) => Promise<SearchResult[]>,
  governed = governedContextPackingApplies(selection),
) {
  const packSelection = governed ? selection : { ...selection, coverageSelections: [], coverage: null };
  const results = await pack(packSelection);
  return governed ? reconcilePackedSelection(selection, results) : { ...selection, results };
}

/** Pack served and retry selections through the same authority before any generation-visible use. */
export async function packModelContextEvidencePair(
  pair: { served: ModelContextEvidenceSelection; strongRetry: ModelContextEvidenceSelection },
  pack: (selection: ModelContextEvidenceSelection) => Promise<SearchResult[]>,
  governed = governedContextPackingApplies(pair.served),
) {
  return {
    served: await packModelContextEvidence(pair.served, pack, governed),
    strongRetry: await packModelContextEvidence(pair.strongRetry, pack, governed),
  };
}

export function buildPackedCrossDocumentFusionBrief(query: string, selection: PackedModelContextEvidenceSelection) {
  return buildCrossDocumentFusionBrief(query, selection.results);
}

const checkedPublishedLayoutsByResults = new WeakMap<SearchResult[], CheckedPublishedOriginalSectionLayout>();
export function checkedPublishedOriginalSectionLayoutForResults(results: SearchResult[]) {
  const layout = checkedPublishedLayoutsByResults.get(results);
  if (layout) recheckCheckedPublishedOriginalSectionLayout(layout, results);
  return layout;
}

/** Whole selected-set admission uses actual serialized tokens and never silently drops units. */
export function packCheckedPublishedOriginalSectionContext(
  results: SearchResult[],
  queryClass: RagQueryClass,
  tokenBudget: number,
  layout: CheckedPublishedOriginalSectionLayout,
) {
  recheckCheckedPublishedOriginalSectionLayout(layout, results);
  if (
    estimateTokens(buildRagSourceBlock(results, { queryClass, checkedOriginalSectionLayout: layout })) > tokenBudget
  ) {
    const error = new Error("Complete published original sections exceed the context budget.");
    error.name = "OriginalSectionLayoutBindingError";
    throw error;
  }
  recheckCheckedPublishedOriginalSectionLayout(layout, results);
  checkedPublishedLayoutsByResults.set(results, layout);
  return results;
}

export function buildContextSourceBlock(results: SearchResult[], options?: Parameters<typeof buildRagSourceBlock>[1]) {
  const layout = checkedPublishedOriginalSectionLayoutForResults(results);
  if (layout) return buildRagSourceBlock(results, { ...options, checkedOriginalSectionLayout: layout });
  const groups = packedGroupsByResultSet.get(results);
  return groups ? buildPackedRagSourceBlock(groups, options) : buildRagSourceBlock(results, options);
}

export function packedContextCacheKey(
  results: SearchResult[],
  queryClass: RagQueryClass,
  options: {
    crossDocument?: boolean;
    documentIds?: string[];
    tokenBudget?: number;
    coverage?: AnswerCoveragePlan | null;
    selections?: CoverageEvidenceSelection[];
    planVersion?: string;
    snapshot?: RagContextSnapshot;
    accessScope?: RetrievalAccessScope;
  } = {},
) {
  const contextLimit = sourceContextPackLimit(queryClass, options);
  if (!options.coverage || !options.selections?.length) {
    const scopeKey = options.documentIds?.length
      ? legacyStableHash([...new Set(options.documentIds)].sort().join("|"))
      : "all-documents";
    return [
      queryClass,
      options.crossDocument ? "cross-document" : "single-document",
      `scope:${scopeKey}`,
      contextLimit,
      ...results
        .slice(0, contextLimit)
        .map((result) => `${result.id}:${result.document_id}:${result.chunk_index}:${result.page_number ?? "na"}`),
    ].join("|");
  }
  if (!options.snapshot || !options.accessScope)
    throw new Error("Governed context packing requires trusted admission.");
  const governedResultIdentity = (result: SearchResult) => ({
    id: result.id,
    documentId: result.document_id,
    chunkIndex: result.chunk_index,
    pageNumber: result.page_number,
    identity: resultIdentity(result),
    role: result.source_metadata?.source_role ?? null,
    currentness: result.source_metadata?.document_status ?? null,
    evidenceFamilyIds: [...evidenceFamilyIdsForResult(result)].sort(),
    serializedInputHash: stableHash(
      buildPackedRagSourceBlock([
        refreshGroup({
          id: "",
          subquestionIds: [],
          required: false,
          claimRole: "treatment",
          evidenceFamilyIds: evidenceFamilyIdsForResult(result),
          corpusScope: result.corpus_scope ?? "uploaded_local",
          ...resultIdentity(result),
          members: [sanitizeStructuredTableFacts(result)],
          atomicFeatures: atomicFeatures([result]),
        }),
      ]),
    ),
  });
  return `${ragContextPackVersion}:${stableHash({
    queryClass,
    crossDocument: Boolean(options.crossDocument),
    scope: [...new Set(options.documentIds ?? [])].sort(),
    tokenBudget: options.tokenBudget ?? contextPackTokenCeiling(queryClass, options),
    planVersion: options.planVersion ?? "legacy-plan",
    snapshotIdentity: ragContextSnapshotCacheKey(options.snapshot),
    accessScope: stableHash(retrievalAccessScopeKey(options.accessScope)),
    coverage: options.coverage
      ? {
          subquestions: options.coverage.subquestions.map((item) => [item.id, item.required]),
          states: options.coverage.coverage.map((item) => [
            item.subquestionId,
            item.status,
            item.chunkIds,
            item.reasonCodes,
          ]),
        }
      : null,
    selections: options.selections?.map((selection) => [
      selection.subquestionId,
      selection.claimRole,
      selection.coverageReason,
      selection.sourcePolicyReview,
      selection.sourcePolicyConflictOmitted,
      selection.conflicts.map((conflict) => [
        conflict.id,
        conflict.claimRole,
        conflict.topicKey,
        conflict.localPrimaryDecision.selected,
        conflict.localPrimaryDecision.reason,
        [...conflict.local.supportingChunkIds].sort(),
        [...conflict.australian.supportingChunkIds].sort(),
      ]),
      selection.orderedEvidence.map(governedResultIdentity),
    ]),
    results: results.map(governedResultIdentity),
  }).slice(0, 40)}`;
}

export function createGenerationContextPacker(options: {
  queryClass: RagQueryClass;
  crossDocument: boolean;
  documentIds?: string[];
  planVersion?: string;
  snapshot: RagContextSnapshot;
  accessScope: RetrievalAccessScope;
  loadLegacy: (results: SearchResult[]) => Promise<SearchResult[]>;
  loadCheckedPublishedOriginal?: (results: SearchResult[], tokenBudget: number) => Promise<SearchResult[] | null>;
  onCacheHit?: () => void;
  onDuration?: (durationMs: number) => void;
}) {
  const cache = new Map<string, SearchResult[]>();
  return async (selection: ModelContextEvidenceSelection) => {
    const tokenBudget = contextPackTokenCeiling(options.queryClass, options);
    const identity = {
      crossDocument: options.crossDocument,
      documentIds: options.documentIds,
      tokenBudget,
      coverage: selection.coverage,
      selections: selection.coverageSelections,
      planVersion: options.planVersion,
      snapshot: options.snapshot,
      accessScope: options.accessScope,
    };
    // Recheck the actual selection even when a prior pack used the same row IDs.
    if (options.loadCheckedPublishedOriginal) {
      const complete = await options.loadCheckedPublishedOriginal(selection.results, tokenBudget);
      if (complete) return complete;
    }
    const key = packedContextCacheKey(selection.results, options.queryClass, identity);
    const cached = options.loadCheckedPublishedOriginal ? undefined : cache.get(key);
    if (cached) {
      options.onCacheHit?.();
      return cached;
    }
    const startedAt = Date.now();
    const packed =
      selection.coverage && selection.coverageSelections.length
        ? packedEvidenceResults(
            packClaimOrientedContext({
              selections: selection.coverageSelections,
              coverage: selection.coverage,
              tokenBudget,
              queryClass: options.queryClass,
              planVersion: options.planVersion,
              snapshot: options.snapshot,
              accessScope: options.accessScope,
            }),
          )
        : await options.loadLegacy(selection.results);
    options.onDuration?.(Date.now() - startedAt);
    if (!options.loadCheckedPublishedOriginal) cache.set(key, packed);
    return packed;
  };
}

export function sourceContextPackLimit(queryClass: RagQueryClass, options: { crossDocument?: boolean } = {}) {
  return options.crossDocument || queryClass === "comparison" || queryClass === "broad_summary" ? 8 : 5;
}

export async function packAdjacentSourceContext(
  supabase: ReturnType<typeof createAdminClient>,
  results: SearchResult[],
  queryClass: RagQueryClass,
  options: { crossDocument?: boolean } = {},
) {
  const contextLimit = sourceContextPackLimit(queryClass, options);
  const targetResults = results.slice(0, contextLimit);
  const documentIds = Array.from(new Set(targetResults.map((result) => result.document_id)));
  const chunkIndexes = Array.from(
    new Set(
      targetResults.flatMap((result) => [result.chunk_index - 1, result.chunk_index + 1]).filter((index) => index >= 0),
    ),
  );
  if (documentIds.length === 0 || chunkIndexes.length === 0) return results;

  try {
    const { data, error } = await supabase
      .from("document_chunks")
      .select("id,document_id,page_number,chunk_index,section_heading,content,retrieval_synopsis,index_generation_id")
      .in("document_id", documentIds)
      .in("chunk_index", chunkIndexes)
      .order("chunk_index", { ascending: true })
      .limit(80);
    if (error || !data?.length) return results;

    const chunksByDocumentAndIndex = new Map<
      string,
      { id: string; section_heading: string | null; content: string; retrieval_synopsis?: string | null }
    >();
    const committedGenerationByDocument = new Map(
      targetResults.map((result) => [result.document_id, committedIndexGeneration(result.source_metadata)] as const),
    );
    for (const chunk of data) {
      const committedGeneration = committedGenerationByDocument.get(chunk.document_id);
      if (chunk.index_generation_id && chunk.index_generation_id !== committedGeneration) continue;
      chunksByDocumentAndIndex.set(`${chunk.document_id}:${chunk.chunk_index}`, {
        id: chunk.id,
        section_heading: chunk.section_heading,
        content: chunk.content,
        retrieval_synopsis: chunk.retrieval_synopsis ?? null,
      });
    }

    const targetIds = new Set(targetResults.map((result) => result.id));
    return results.map((result) => {
      if (!targetIds.has(result.id)) return result;
      const adjacent = [result.chunk_index - 1, result.chunk_index + 1]
        .map((index) => chunksByDocumentAndIndex.get(`${result.document_id}:${index}`))
        .filter((chunk): chunk is NonNullable<typeof chunk> =>
          Boolean(chunk && chunk.id !== result.id && chunk.content.trim()),
        )
        .map((chunk) => {
          const heading = chunk.section_heading ? `${chunk.section_heading}: ` : "";
          return compactContextText(`${heading}${chunk.retrieval_synopsis || chunk.content}`, 520);
        });
      return adjacent.length ? { ...result, adjacent_context: adjacent.join(" ") } : result;
    });
  } catch {
    return results;
  }
}

export function attachAdjacentContext(results: SearchResult[], packed: SearchResult[]): SearchResult[] {
  const adjacentById = new Map<string, string>();
  for (const source of packed) if (source.adjacent_context) adjacentById.set(source.id, source.adjacent_context);
  if (adjacentById.size === 0) return results;
  return results.map((result) => {
    const adjacent = adjacentById.get(result.id);
    return adjacent && adjacent !== result.adjacent_context ? { ...result, adjacent_context: adjacent } : result;
  });
}
