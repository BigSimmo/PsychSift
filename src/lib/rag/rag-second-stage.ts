import { rankingConfig, type RankingConfig } from "@/lib/ranking-config";
import { visualEvidenceUnitTypes } from "@/lib/rag/rag-evidence-gates";
import type { SearchTelemetry } from "@/lib/rag/rag-contracts";
import type { RagQueryClass, SearchResult } from "@/lib/types";

// Extracted from rag.ts (maturity X3): second-stage engagement, scoring, and
// telemetry. The implementation is unchanged; rag.ts remains the orchestrator.

const tableVisualEvidenceUnitTypes = new Set([
  "table_fact",
  "table_threshold",
  "medication_chart_row",
  "risk_matrix_cell",
]);

/** Layer top score. */
export function layerTopScore(results: SearchResult[]) {
  return Number(Math.max(0, ...results.map((result) => result.hybrid_score ?? result.similarity ?? 0)).toFixed(4));
}

/** Record retrieval layer. */
export function recordRetrievalLayer(
  telemetry: SearchTelemetry,
  layer: string,
  count: number,
  options: { latencyMs?: number; topScore?: number } = {},
) {
  telemetry.retrieval_layer_counts = {
    ...(telemetry.retrieval_layer_counts ?? {}),
    [layer]: count,
  };
  if (typeof options.latencyMs === "number") {
    telemetry.retrieval_layer_latencies_ms = {
      ...(telemetry.retrieval_layer_latencies_ms ?? {}),
      [layer]: Math.max(0, Math.round(options.latencyMs)),
    };
  }
  if (typeof options.topScore === "number") {
    telemetry.retrieval_layer_top_scores = {
      ...(telemetry.retrieval_layer_top_scores ?? {}),
      [layer]: Number(Math.max(0, options.topScore).toFixed(4)),
    };
  }
}

/** Should use second stage rerank. */
function shouldUseSecondStageRerank(queryClass: RagQueryClass | undefined, results: SearchResult[], topK: number) {
  if (results.length <= 1) return false;
  const topScore = Math.max(0, results[0]?.hybrid_score ?? results[0]?.similarity ?? 0);
  const secondScore = Math.max(0, results[1]?.hybrid_score ?? results[1]?.similarity ?? 0);
  const topScoresClose = Math.abs(topScore - secondScore) <= 0.04;
  const hasVisualEvidence = results.some((result) => visualEvidenceUnitTypes.has(result.index_unit?.unit_type ?? ""));
  const hasTableVisualEvidence = results.some((result) =>
    tableVisualEvidenceUnitTypes.has(result.index_unit?.unit_type ?? ""),
  );
  if (queryClass === "table_threshold" || queryClass === "medication_dose_risk") {
    return hasVisualEvidence || hasTableVisualEvidence || topScoresClose;
  }
  if (queryClass === "comparison") return results.length > topK || topScoresClose;
  return topScoresClose && hasVisualEvidence;
}

/** Second stage score. */
function secondStageScore(
  result: SearchResult,
  queryClass: RagQueryClass | undefined,
  index: number,
  activeRankingConfig: Readonly<RankingConfig>,
) {
  const baseRankScore =
    result.score_explanation?.rankScore ??
    result.score_explanation?.preClampFinalScore ??
    result.score_explanation?.finalScore ??
    result.hybrid_score ??
    result.similarity ??
    0;
  let adjustment = 0;
  const unitType = result.index_unit?.unit_type ?? "";
  const source = result.index_unit?.metadata?.source;
  const sourceQuality = Number(result.index_unit?.quality_score ?? 0.65);
  const doseAmountText = `${result.section_heading ?? ""} ${result.content} ${(result.images ?? [])
    .map((image) => `${image.caption ?? ""} ${image.tableTextSnippet ?? ""} ${image.tableTitle ?? ""}`)
    .join(" ")} ${(result.table_facts ?? [])
    .map(
      (fact) => `${fact.table_title ?? ""} ${fact.row_label ?? ""} ${fact.threshold_value ?? ""} ${fact.action ?? ""}`,
    )
    .join(" ")}`;
  const hasDoseAmount = /\b\d+(?:\.\d+)?\s?(?:mg|mcg|microgram|micrograms)\b/i.test(doseAmountText);
  const w = activeRankingConfig.secondStage;
  adjustment += Math.max(0, w.positionBase - index * w.positionStep);
  if (result.memory_cards?.length && (queryClass === "broad_summary" || queryClass === "comparison"))
    adjustment += w.memorySummaryBoost;
  if (queryClass === "document_lookup" && (result.match_explanation?.titleHit || result.match_explanation?.labelHit))
    adjustment += w.documentLookupTitleBoost;
  if ((queryClass === "table_threshold" || queryClass === "medication_dose_risk") && result.table_facts?.length)
    adjustment += w.tableThresholdEvidenceBoost;
  if (queryClass === "medication_dose_risk" && hasDoseAmount) adjustment += w.doseAmountBoost;
  if (tableVisualEvidenceUnitTypes.has(unitType)) adjustment += w.tableVisualBoost;
  else if (visualEvidenceUnitTypes.has(unitType)) adjustment += w.visualBoost;
  if (source === "visual_intelligence")
    adjustment += Math.min(
      w.visualIntelligenceMax,
      Math.max(0, sourceQuality - w.visualIntelligencePivot) * w.visualIntelligenceSlope,
    );
  if (result.source_metadata?.document_status === "outdated") adjustment -= w.outdatedPenalty;
  // D4: ships 0 (no-op) — activate via RAG_RANKING_CONFIG only behind a green golden eval.
  if (result.source_metadata?.document_status === "unknown") adjustment -= w.unknownCurrentnessPenalty;
  if (result.source_metadata?.extraction_quality === "poor") adjustment -= w.poorExtractionPenalty;
  if (
    result.indexing_quality?.quality_score !== undefined &&
    result.indexing_quality.quality_score < w.lowIndexQualityThreshold
  )
    adjustment -= w.lowIndexQualityPenalty;
  return { rankScore: baseRankScore + adjustment, adjustment };
}

/** Apply second stage rerank if needed. */
export function applySecondStageRerankIfNeeded(args: {
  queryClass?: RagQueryClass;
  results: SearchResult[];
  telemetry: SearchTelemetry;
  topK: number;
  ranking?: Readonly<RankingConfig>;
}) {
  if (!shouldUseSecondStageRerank(args.queryClass, args.results, args.topK)) return args.results;
  const activeRankingConfig = args.ranking ?? rankingConfig;
  const startedAt = Date.now();
  // CI-16 document diversity: subtract a demotion from each EXTRA chunk of a document that
  // has already appeared higher up, so a single doc's sibling chunks can't crowd out other
  // documents. Applied AFTER the additive-boost floor so it can actually lower the effective
  // rank. Keep this separate from the selection-rescue floor in retrieval-selection.ts.
  const seenPerDocument = new Map<string, number>();
  const reranked = args.results
    .map((result, index) => {
      const secondStage = secondStageScore(result, args.queryClass, index, activeRankingConfig);
      let rankScore = secondStage.rankScore;
      let confidenceAdjustment = secondStage.adjustment;
      const releasedHybridScore = result.hybrid_score ?? result.similarity ?? 0;
      let releaseRankScore = Math.max(
        releasedHybridScore,
        (result.score_explanation?.finalScore ?? result.hybrid_score ?? result.similarity ?? 0) +
          secondStage.adjustment,
      );
      const priorOccurrences = seenPerDocument.get(result.document_id) ?? 0;
      seenPerDocument.set(result.document_id, priorOccurrences + 1);
      if (activeRankingConfig.documentDiversityPenalty > 0 && priorOccurrences > 0) {
        const diversityPenalty = Math.min(
          activeRankingConfig.documentDiversityPenaltyCap,
          activeRankingConfig.documentDiversityPenalty * priorOccurrences,
        );
        rankScore -= diversityPenalty;
        confidenceAdjustment -= diversityPenalty;
        releaseRankScore -= diversityPenalty;
      }
      const selectionReasons = result.match_explanation?.reasons ?? [];
      const clinicalSubjectRequired = selectionReasons.includes("retrieval_required_signal:clinical_subject");
      const clinicalSubjectMatched = selectionReasons.includes("retrieval_signal:clinical_subject");
      if (clinicalSubjectRequired && !clinicalSubjectMatched) {
        // A wrong-medication chunk can carry attractive numeric dose/monitoring signals. Keep it
        // available at its released hybrid strength, but do not let second-stage evidence boosts
        // promote it above chunks that contain the medication subject requested by the query.
        releaseRankScore = Math.min(releaseRankScore, releasedHybridScore);
      }
      const finalScore = Math.min(
        1,
        Math.max(
          0,
          (result.score_explanation?.finalScore ?? result.hybrid_score ?? result.similarity ?? 0) +
            confidenceAdjustment,
        ),
      );
      return {
        rankScore,
        result: {
          ...result,
          score_explanation: result.score_explanation
            ? {
                ...result.score_explanation,
                rankScore: Number(rankScore.toFixed(4)),
                releaseRankScore: Number(releaseRankScore.toFixed(4)),
                preClampFinalScore: Number(rankScore.toFixed(4)),
                finalScore: Number(finalScore.toFixed(4)),
              }
            : result.score_explanation,
          match_explanation: {
            ...result.match_explanation,
            reasons: Array.from(new Set([...(result.match_explanation?.reasons ?? []), "second_stage_rerank"])),
          },
        },
      };
    })
    .sort((left, right) => right.rankScore - left.rankScore || left.result.id.localeCompare(right.result.id))
    .map(({ result }, index) =>
      result.score_explanation
        ? { ...result, score_explanation: { ...result.score_explanation, finalRank: index + 1 } }
        : result,
    );
  args.telemetry.second_stage_rerank_used = true;
  args.telemetry.second_stage_rerank_latency_ms =
    (args.telemetry.second_stage_rerank_latency_ms ?? 0) + Date.now() - startedAt;
  recordRetrievalLayer(args.telemetry, "second_stage_rerank", reranked.length, {
    latencyMs: Date.now() - startedAt,
    topScore: layerTopScore(reranked),
  });
  return reranked;
}
