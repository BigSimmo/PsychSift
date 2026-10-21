import { evaluateShadowCandidateMatchCounts } from "@/lib/rag/rag-coverage";
import type { RetrievalStageTiming, SearchTelemetry } from "@/lib/rag/rag-contracts";
import type { RagQueryPlan, SearchResult } from "@/lib/types";

export type SearchTiming = {
  startedAt: number;
  phases: Record<string, number>;
  /** Measurement only: sequential stage offsets, surfaced as retrieval_stage_timeline_ms. */
  stages?: RetrievalStageTiming[];
  shadowPlan?: RagQueryPlan;
  shadowCandidateResults?: SearchResult[];
  shadowState?: "pending" | "completed" | "failed" | "cancelled";
  closeShadow?: () => void;
};

/** The child shares caller cancellation, but legacy completion may cancel it independently. */
export function startShadowSearch(
  timing: SearchTiming,
  parentSignal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<{ candidateResults: SearchResult[] } | null>,
) {
  const child = new AbortController();
  let closed = false;
  const abort = () => child.abort();
  if (parentSignal?.aborted) abort();
  else parentSignal?.addEventListener("abort", abort, { once: true });
  timing.shadowState = "pending";
  timing.closeShadow = () => {
    if (closed) return;
    closed = true;
    parentSignal?.removeEventListener("abort", abort);
    if (timing.shadowState === "pending") timing.shadowState = "cancelled";
    child.abort();
  };
  // Consume every rejection, including synchronous adapter failures, without logging private text.
  void Promise.resolve()
    .then(() => {
      child.signal.throwIfAborted();
      return operation(child.signal);
    })
    .then(
      (result) => {
        if (closed) return;
        timing.shadowState = "completed";
        timing.shadowCandidateResults = result?.candidateResults ?? [];
      },
      () => {
        if (!closed) timing.shadowState = child.signal.aborted ? "cancelled" : "failed";
      },
    );
}

export function closeShadowSearch(timing: SearchTiming) {
  timing.closeShadow?.();
}

/** Measurement only: bounds on the stage timeline so telemetry rows stay small. */
export const MAX_STAGE_TIMELINE_ENTRIES = 64;
export const MAX_STAGE_NAME_LENGTH = 80;
const NESTED_PREFIX = "nested:";

function pushStage(timing: SearchTiming, entry: RetrievalStageTiming) {
  const stages = (timing.stages ??= []);
  if (stages.length >= MAX_STAGE_TIMELINE_ENTRIES) return;
  const stage = entry.stage.slice(0, MAX_STAGE_NAME_LENGTH);
  // Drop exact repeats (same stage, same offsets) so a re-merged nested timeline is not doubled.
  if (
    stages.some(
      (existing) =>
        existing.stage === stage &&
        existing.started_offset_ms === entry.started_offset_ms &&
        existing.finished_offset_ms === entry.finished_offset_ms,
    )
  ) {
    return;
  }
  stages.push({ ...entry, stage });
}

export function createSearchTiming(): SearchTiming {
  return { startedAt: Date.now(), phases: {}, stages: [] };
}

/**
 * Measurement only: fold a nested search's stage timeline (offsets relative to its own start)
 * into this timing, shifted onto this timing's clock. Never affects control flow.
 */
export function mergeNestedSearchStages(
  timing: SearchTiming,
  nestedStages: RetrievalStageTiming[] | undefined,
  nestedStartedAt: number,
) {
  if (!nestedStages?.length) return;
  const shift = nestedStartedAt - timing.startedAt;
  for (const stage of nestedStages) {
    // A nested search's own nested stages keep a single prefix rather than nested:nested:...
    const name = stage.stage.startsWith(NESTED_PREFIX) ? stage.stage : `${NESTED_PREFIX}${stage.stage}`;
    pushStage(timing, {
      stage: name,
      started_offset_ms: stage.started_offset_ms + shift,
      finished_offset_ms: stage.finished_offset_ms + shift,
    });
  }
}

/** Measurement only: record a stage's start/finish offsets; never affects control flow. */
export function recordSearchStage(timing: SearchTiming, stage: string, startedAt: number, finishedAt = Date.now()) {
  pushStage(timing, {
    stage,
    started_offset_ms: startedAt - timing.startedAt,
    finished_offset_ms: finishedAt - timing.startedAt,
  });
}

export async function measureSearchPhase<T>(
  timing: SearchTiming,
  phase: string,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await operation();
  } finally {
    const finishedAt = Date.now();
    timing.phases[phase] = (timing.phases[phase] ?? 0) + (finishedAt - startedAt);
    recordSearchStage(timing, phase, startedAt, finishedAt);
  }
}

/**
 * Supabase hydration phases that run inside the rerank windows. `rerank_latency_ms` excludes them,
 * so it times ranking work rather than database round trips (those stay visible, per phase, in
 * `retrieval_phase_latencies_ms`). Measurement only: nothing here changes ranking or ordering.
 */
const RERANK_EXCLUDED_HYDRATION_PHASES = [
  "metadata_hydration",
  "memory_hydration",
  "visual_hydration",
  "metadata_and_memory_hydration",
] as const;

function hydrationPhaseMs(timing: SearchTiming) {
  return RERANK_EXCLUDED_HYDRATION_PHASES.reduce((total, phase) => total + (timing.phases[phase] ?? 0), 0);
}

/**
 * Starts a rerank clock. The returned function reports the time elapsed since the start, less any
 * hydration-phase time recorded in the meantime. Clamped at zero because a concurrent lane can
 * record hydration time that overlaps the window.
 */
export function startRerankClock(timing: SearchTiming): () => number {
  const startedAt = Date.now();
  const hydrationAtStart = hydrationPhaseMs(timing);
  return () => Math.max(0, Date.now() - startedAt - (hydrationPhaseMs(timing) - hydrationAtStart));
}

export function finishSearch<T extends { results: SearchResult[]; telemetry: SearchTelemetry }>(
  timing: SearchTiming,
  search: T,
): T {
  closeShadowSearch(timing);
  if (timing.shadowState) search.telemetry.shadow_retrieval_state = timing.shadowState;
  if (timing.shadowPlan && timing.shadowState === "completed" && !search.telemetry.candidate_match_counts) {
    search.telemetry.candidate_match_counts = evaluateShadowCandidateMatchCounts(
      timing.shadowPlan,
      timing.shadowCandidateResults ?? [],
    );
  }
  search.telemetry.retrieval_phase_latencies_ms = { ...timing.phases };
  // Authoritative per request: an absent timeline is cleared rather than carried over.
  if (timing.stages?.length) {
    search.telemetry.retrieval_stage_timeline_ms = timing.stages
      .slice(0, MAX_STAGE_TIMELINE_ENTRIES)
      .map((stage) => ({ ...stage }));
  } else {
    delete search.telemetry.retrieval_stage_timeline_ms;
  }
  search.telemetry.search_total_latency_ms = Date.now() - timing.startedAt;
  return search;
}
