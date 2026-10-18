import {
  answerInflight,
  answerInflightCacheKey,
  cloneAnswer,
  withRagAnswerQueryPlanDiagnostics,
} from "@/lib/rag/rag-cache";
import {
  recordAnswerOrigination,
  recordAnswerOriginationFinished,
  recordCoalescedAnswerWaiter,
} from "@/lib/observability/answer-coalescing-metrics";
import { awaitWithCallerSignal } from "@/lib/rag/rag-abort-signal";
import { observeRagAnswer } from "@/lib/rag/rag-programme-telemetry";
import type { RagObservationContext, SearchChunksArgs } from "@/lib/rag/rag-contracts";
import type { RagAnswer } from "@/lib/types";

type CoalescingRequest = SearchChunksArgs & {
  onProgress?: (event: { stage: "cached"; message: string; reason: string }) => void | Promise<void>;
  observationContext?: RagObservationContext;
};

/** Join only a current answer promise, or originate once without replacing another caller. */
export async function answerWithCoalescing(
  args: CoalescingRequest,
  startedAt: number,
  enabled: boolean,
  originate: () => Promise<RagAnswer>,
): Promise<RagAnswer> {
  let inflightKey = enabled ? await answerInflightCacheKey(args) : null;
  let existing = inflightKey ? answerInflight.get(inflightKey) : undefined;

  while (existing) {
    recordCoalescedAnswerWaiter();
    await args.onProgress?.({
      stage: "cached",
      message: "Waiting for an identical cited answer request already in progress.",
      reason: "answer_inflight_coalesced",
    });
    try {
      const sharedAnswer = await awaitWithCallerSignal(existing, args.signal);
      const currentInflightKey = await answerInflightCacheKey(args);
      if (currentInflightKey !== inflightKey) {
        // Review committed while waiting (or freshness is unavailable). Originate
        // once against current state; never deliver the old promise's evidence.
        inflightKey = currentInflightKey;
        break;
      }
      const answer = cloneAnswer(sharedAnswer);
      answer.routingReason = answer.routingReason
        ? `${answer.routingReason}; answer_inflight_coalesced`
        : "answer_inflight_coalesced";
      answer.latencyTimings = {
        ...answer.latencyTimings,
        total_latency_ms: Date.now() - startedAt,
      };
      return observeRagAnswer(answer, args.observationContext);
    } catch {
      if (args.signal?.aborted) {
        throw args.signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
      }
      // An originating caller's abort/failure must not fail this connected waiter.
      // Recheck first: another waiter may have installed a replacement while the
      // rejected promise's microtasks drained.
      const replacement = inflightKey ? answerInflight.get(inflightKey) : undefined;
      if (replacement && replacement !== existing) {
        existing = replacement;
        continue;
      }
      break;
    }
  }

  // A stale waiter may reach a revision another caller already owns. Do not
  // replace that caller's promise; this bounded fallback originates independently.
  const originationKey = inflightKey && !answerInflight.has(inflightKey) ? inflightKey : null;
  if (originationKey) recordAnswerOrigination();
  const pending = originate()
    .then((answer) => withRagAnswerQueryPlanDiagnostics(answer, args))
    .finally(() => {
      if (originationKey) {
        if (answerInflight.get(originationKey) === pending) answerInflight.delete(originationKey);
        recordAnswerOriginationFinished();
      }
    });
  if (originationKey) answerInflight.set(originationKey, pending);
  return observeRagAnswer(await pending, args.observationContext);
}
