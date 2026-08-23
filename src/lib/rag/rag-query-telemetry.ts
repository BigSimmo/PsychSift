import { env } from "@/lib/env";
import {
  answerPrivacyMetadata,
  answerTextForStorage,
  queryPrivacyMetadata,
  queryTextForStorage,
} from "@/lib/query-privacy";
import { answerProgrammeTelemetryMetadata } from "@/lib/rag/rag-answer-telemetry-metadata";
import { fallbackReasonFromRouting } from "@/lib/rag/rag-answer-support";
import type { RagObservationContext } from "@/lib/rag/rag-contracts";
import { boundedAnswerTelemetryReasons, withRagProgrammeDiagnostics } from "@/lib/rag/rag-programme-telemetry";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { RagAnswer, SearchResult } from "@/lib/types";

export type RagQueryInsert = Omit<Database["public"]["Tables"]["rag_queries"]["Insert"], "metadata"> & {
  metadata?: Record<string, unknown>;
};
export type RagQueryTelemetryFinalizer = (answer: RagAnswer) => RagAnswer;

export function finalRagQueryTelemetryAnswer(answer: RagAnswer, finalizer?: RagQueryTelemetryFinalizer) {
  return finalizer?.(answer) ?? answer;
}

export function finalRagQueryOutcomeMetadata(answer: RagAnswer) {
  const bounded = boundedAnswerTelemetryReasons(answer);
  return {
    grounded: answer.grounded,
    confidence: answer.confidence,
    routing_mode: bounded.route,
    routing_reason: bounded.route,
    fallback_reason: bounded.insufficiencyReason,
  };
}

export function finalRagQueryFields(
  originalAnswer: RagAnswer,
  finalizer: RagQueryTelemetryFinalizer | undefined,
  originalSources: readonly Pick<SearchResult, "id">[],
  observationContext?: RagObservationContext,
  routingReason = originalAnswer.routingReason,
) {
  const answer = finalRagQueryTelemetryAnswer(originalAnswer, finalizer);
  const sourceChunkIds = (answer === originalAnswer ? originalSources : answer.sources).map((source) => source.id);
  return answer === originalAnswer && !observationContext
    ? {
        answer,
        sourceChunkIds,
        outcomeMetadata: {
          grounded: originalAnswer.grounded,
          confidence: originalAnswer.confidence,
          routing_mode: originalAnswer.routingMode,
          routing_reason: routingReason,
          fallback_reason: fallbackReasonFromRouting(originalAnswer.routingReason),
        },
      }
    : {
        answer,
        sourceChunkIds,
        outcomeMetadata: finalRagQueryOutcomeMetadata(answer),
      };
}

async function insertRagQuery(row: RagQueryInsert) {
  const supabase = createAdminClient();
  const rawQuery = typeof row.query === "string" ? row.query : "";
  const safeRow = {
    ...row,
    query: queryTextForStorage(rawQuery),
    answer: answerTextForStorage(row.answer),
    metadata: {
      ...(row.metadata ?? {}),
      ...queryPrivacyMetadata(rawQuery),
      ...answerPrivacyMetadata(),
    } as Json,
  };
  await supabase.from("rag_queries").insert(safeRow);
}

export async function logRagQuery(row: RagQueryInsert) {
  if (env.RAG_AWAIT_QUERY_LOGS) {
    await insertRagQuery(row);
    return;
  }
  void insertRagQuery(row).catch(() => undefined);
}

export async function logRagQueryOutcome(args: {
  query: string;
  ownerId?: string | null;
  answer: RagAnswer;
  candidateResults?: readonly SearchResult[];
  observationContext?: RagObservationContext;
  finalizeTelemetryAnswer?: RagQueryTelemetryFinalizer;
  outcome: "cache" | "coalesced" | "summary" | "empty_scope";
}) {
  if (!args.observationContext) return args.answer;
  const answer = withRagProgrammeDiagnostics(args.answer, args.candidateResults ?? []);
  const telemetryAnswer = finalRagQueryTelemetryAnswer(answer, args.finalizeTelemetryAnswer);
  await logRagQuery({
    owner_id: args.ownerId ?? null,
    query: args.query,
    answer: telemetryAnswer.answer,
    source_chunk_ids: telemetryAnswer.sources.map((source) => source.id),
    model: telemetryAnswer.modelUsed ?? null,
    metadata: {
      ...answerProgrammeTelemetryMetadata(args.observationContext, telemetryAnswer),
      telemetry_outcome: args.outcome,
      ...finalRagQueryOutcomeMetadata(telemetryAnswer),
    },
  });
  return answer;
}

export async function logRagQueryOutcomeForAnswerArgs(
  args: {
    query: string;
    ownerId?: string;
    logQuery?: boolean;
    observationContext?: RagObservationContext;
    finalizeTelemetryAnswer?: RagQueryTelemetryFinalizer;
  },
  answer: RagAnswer,
  outcome: "cache" | "coalesced",
) {
  return args.logQuery === false
    ? answer
    : logRagQueryOutcome({
        query: args.query,
        ownerId: args.ownerId,
        answer,
        observationContext: args.observationContext,
        finalizeTelemetryAnswer: args.finalizeTelemetryAnswer,
        outcome,
      });
}
