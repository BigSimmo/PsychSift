import { env } from "@/lib/env";
import type { RagObservationContext } from "@/lib/rag/rag-contracts";
import {
  buildRagQueryMetadata,
  buildRagRetrievalMetadata,
  programmeTelemetryInputForAnswer,
  type RagProgrammeTelemetryInput,
} from "@/lib/rag/rag-programme-telemetry";
import type { RagAnswer } from "@/lib/types";

type AnswerLatencyTimings = NonNullable<RagAnswer["latencyTimings"]>;

/**
 * Packet B1 (docs/rag-improvement/README.md §B1): the tail latency fields every
 * answer-path `rag_queries.metadata` block persists, plus the extended fields added
 * behind `RAG_TELEMETRY_EXTENDED` (default false — that flag is the whole-surface
 * rollback for B1).
 *
 * The extended projection is fail-closed by construction: only keys named in
 * `EXTENDED_ANSWER_TELEMETRY_ALLOWLIST` are read from the timings object, and only
 * finite numbers are emitted, so free text — including the adversarial-fixture canary
 * tokens — can never reach the telemetry sink through this path even from a
 * contaminated input. `tests/rag-telemetry-canary-absence.test.ts` pins both
 * properties against the registered canary tokens, and pins that the flag-off shape
 * is byte-identical to the legacy three-field output.
 */
export const EXTENDED_ANSWER_TELEMETRY_ALLOWLIST = ["verification_latency_ms"] as const;

type ExtendedAnswerTelemetryKey = (typeof EXTENDED_ANSWER_TELEMETRY_ALLOWLIST)[number];

export function extendedAnswerTelemetryFields(
  timings: AnswerLatencyTimings | null | undefined,
): Partial<Record<ExtendedAnswerTelemetryKey, number>> {
  if (!env.RAG_TELEMETRY_EXTENDED) return {};
  const source: Record<string, unknown> = timings ?? {};
  const fields: Partial<Record<ExtendedAnswerTelemetryKey, number>> = {};
  for (const key of EXTENDED_ANSWER_TELEMETRY_ALLOWLIST) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) fields[key] = value;
  }
  return fields;
}

export function ragProgrammeTelemetryMetadata(input: RagProgrammeTelemetryInput | null | undefined) {
  if (!input) return {};
  const metadata = buildRagQueryMetadata(input);
  return env.RAG_TELEMETRY_EXTENDED ? metadata : { interaction_id: metadata.interaction_id };
}

export function answerProgrammeTelemetryMetadata(
  observationContext: RagObservationContext | null | undefined,
  answer: Parameters<typeof programmeTelemetryInputForAnswer>[0]["answer"],
) {
  return observationContext
    ? ragProgrammeTelemetryMetadata(programmeTelemetryInputForAnswer({ observationContext, answer }))
    : {};
}

export function retrievalProgrammeTelemetryMetadata(
  observationContext: RagObservationContext | null | undefined,
  answer: Parameters<typeof programmeTelemetryInputForAnswer>[0]["answer"],
) {
  if (!observationContext) return {};
  const metadata = buildRagRetrievalMetadata(programmeTelemetryInputForAnswer({ observationContext, answer }));
  return env.RAG_TELEMETRY_EXTENDED ? metadata : { interaction_id: metadata.interaction_id };
}

export function answerLatencyMetadata(
  searchLatencyMs: number,
  generationLatencyMs: number,
  timings: AnswerLatencyTimings | null | undefined,
  startedAt: number,
): Record<string, unknown> {
  return {
    search_latency_ms: searchLatencyMs,
    generation_latency_ms: generationLatencyMs,
    total_latency_ms: timings?.total_latency_ms ?? Date.now() - startedAt,
    ...extendedAnswerTelemetryFields(timings),
  };
}
