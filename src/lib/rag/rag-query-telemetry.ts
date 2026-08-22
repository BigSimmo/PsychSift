import { env } from "@/lib/env";
import {
  answerPrivacyMetadata,
  answerTextForStorage,
  queryPrivacyMetadata,
  queryTextForStorage,
} from "@/lib/query-privacy";
import { answerProgrammeTelemetryMetadata } from "@/lib/rag/rag-answer-telemetry-metadata";
import type { RagObservationContext } from "@/lib/rag/rag-contracts";
import { boundedAnswerTelemetryReasons, withRagProgrammeDiagnostics } from "@/lib/rag/rag-programme-telemetry";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { RagAnswer, SearchResult } from "@/lib/types";

export type RagQueryInsert = Omit<Database["public"]["Tables"]["rag_queries"]["Insert"], "metadata"> & {
  metadata?: Record<string, unknown>;
};

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
  outcome: "cache" | "coalesced" | "summary" | "empty_scope";
}) {
  if (!args.observationContext) return args.answer;
  const answer = withRagProgrammeDiagnostics(args.answer, args.candidateResults ?? []);
  const bounded = boundedAnswerTelemetryReasons(answer);
  await logRagQuery({
    owner_id: args.ownerId ?? null,
    query: args.query,
    answer: answer.answer,
    source_chunk_ids: answer.sources.map((source) => source.id),
    model: answer.modelUsed ?? null,
    metadata: {
      ...answerProgrammeTelemetryMetadata(args.observationContext, answer),
      telemetry_outcome: args.outcome,
      grounded: answer.grounded,
      confidence: answer.confidence,
      routing_mode: bounded.route,
      fallback_reason: bounded.insufficiencyReason,
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
        outcome,
      });
}
