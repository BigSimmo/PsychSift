import { randomUUID } from "node:crypto";
import { z } from "zod";
import { demoAnswer, demoSummary } from "@/lib/demo-data";
import { isDemoMode } from "@/lib/env";
import { PublicApiError, jsonError } from "@/lib/http";
import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSummaryRateLimits,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
  type ApiRateLimitResult,
} from "@/lib/api-rate-limit";
import { publicAccessContext } from "@/lib/public-api-access";
import { setAgentConversationId } from "@/lib/observability/agent-monitoring";
import {
  buildGovernedAnswerClientResponse,
  buildGovernedDemoAnswerClientResponse,
  buildGovernedEmptyScopeAnswerClientResponse,
} from "@/lib/answer-response";
import { answerQuestionWithScope, summarizeDocument, type AnswerProgressEvent } from "@/lib/rag/rag";
import { classifyRagQuery } from "@/lib/clinical-search";
import { annotateSearchResults, buildEvidenceRelevance } from "@/lib/evidence-relevance";
import { buildSmartRagApiPlan } from "@/lib/smart-rag-api";
import { queryClassForClinicalMode, queryForClinicalMode } from "@/lib/clinical-query-mode";
import { resolveSearchScope } from "@/lib/search-scope";
import { resolveRetrievalAccessScope, type RetrievalAccessScope } from "@/lib/owner-scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { persistAnswerDiagnostics } from "@/lib/answer-telemetry";
import { isSupabaseApiKeyConfigurationError, nonProductionSupabaseDemoFallbackReason } from "@/lib/supabase/errors";
import { AuthenticationError, unauthorizedResponse } from "@/lib/supabase/auth";
import { logger } from "@/lib/logger";
import { safeErrorLogDetails } from "@/lib/privacy";
import { buildServerTimingHeader, preambleServerTimingEntries } from "@/lib/server-timing";
import { startSseHeartbeat } from "@/lib/sse-heartbeat";
import { parseJsonBody } from "@/lib/validation/body";
import { rejectPatientDetailQuestion } from "@/lib/clinical-question-patient-check-server";
import { answerRequestSchema, type AnswerRequestBody } from "@/lib/validation/answer-request";
import type { AnswerStreamEventMap, AnswerStreamEventName } from "@/lib/answer-stream-contract";
import { toPublicAnswerProgressEvent } from "@/lib/answer-progress-public";
import { answerFeedbackMetadata } from "@/lib/answer-feedback-token";
import { observeRagAnswer } from "@/lib/rag/rag-programme-telemetry";
import { toClientSearchScopeSummary } from "@/lib/answer-client-payload";
import { apiErrorCodeSchema, apiStreamErrorPayloadSchema } from "@/lib/api-error-payload";
import { registeredPublicAnswerOptions } from "@/lib/registered-public-answer-options";
import { AnswerPilotBudgetError, runAnswerWithPilotBudget } from "@/lib/answer-pilot-budget";

export const runtime = "nodejs";

const emptyScopeAnswer =
  "The selected filters did not match any indexed documents, so I cannot generate an answer for that scope.";

function encodeSse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function rateLimitStream(rateLimit: ApiRateLimitResult) {
  return rateLimitJsonResponse("Too many answer requests. Retry shortly.", rateLimit, { bucket: "answer" });
}

function documentSummaryRateLimitStream(rateLimit: ApiRateLimitResult) {
  return rateLimitJsonResponse("Too many document summary requests. Retry shortly.", rateLimit);
}

function mergeAbortSignals(signals: Array<AbortSignal | undefined>) {
  const controller = new AbortController();
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener(
      "abort",
      () => {
        if (!controller.signal.aborted) controller.abort(signal.reason);
      },
      { once: true },
    );
  }
  return controller.signal;
}

function streamErrorPayload(error: unknown) {
  const payload = (message: string, status: number, code: string) =>
    apiStreamErrorPayloadSchema.parse({ error: message, message, code, status });
  if (error instanceof PublicApiError) {
    const code = apiErrorCodeSchema.safeParse(error.details?.code);
    return payload(error.message, error.status, code.success ? code.data : "request_failed");
  }

  // Production has no demo fallback for a misconfigured Supabase key, so tag the
  // SSE error with a stable code operators can spot in the client/network tab.
  if (isSupabaseApiKeyConfigurationError(error)) {
    return payload("Answer generation failed. Retry with a narrower question.", 500, "supabase_api_key_configuration");
  }

  if (error instanceof Error) {
    // Match the non-streaming /api/answer route, which returns 500 for a
    // generic answer-generation failure. Never expose unstable Error.name.
    return payload("Answer generation failed. Retry with a narrower question.", 500, "internal_error");
  }

  return payload("Search processing is temporarily unavailable.", 503, "service_unavailable");
}

function streamAnswerFeedbackMetadata(interactionId: string, answer: string) {
  return isDemoMode() ? { interactionId } : answerFeedbackMetadata(interactionId, answer);
}

function logStreamError(error: unknown, signal?: AbortSignal) {
  // Client aborts (Stop button / watchdog) and expected sub-500 degradations are
  // operational noise, not failures — the caller still surfaces them to the client
  // via the SSE error event. Only genuine server-fault stream failures are logged.
  if ((error instanceof DOMException && error.name === "AbortError") || signal?.aborted) return;
  if (error instanceof PublicApiError && error.status < 500) return;
  logger.error("Search stream failed", safeErrorLogDetails(error));
}

function buildDemoStreamAnswer(body: AnswerRequestBody, fallbackReason?: string) {
  const demo =
    body.summaryMode && body.documentId
      ? demoSummary(body.documentId)
      : demoAnswer(body.query, body.documentId, body.documentIds);
  const answerFocusQuery = queryForClinicalMode(body.query, body.queryMode);
  const sources = annotateSearchResults(answerFocusQuery, demo.sources);
  const relevance = buildEvidenceRelevance(answerFocusQuery, sources);
  return buildGovernedDemoAnswerClientResponse(
    {
      ...demo,
      sources,
      relevance,
      smartPanel: demo.smartPanel ? { ...demo.smartPanel, relevance } : demo.smartPanel,
      smartApiPlan: buildSmartRagApiPlan({
        query: answerFocusQuery,
        queryClass: queryClassForClinicalMode(body.queryMode) ?? classifyRagQuery(answerFocusQuery).queryClass,
        results: sources,
        routeMode: demo.routingMode,
        retrievalStrategy: "hybrid",
      }),
    },
    fallbackReason,
  );
}

function streamAnswer(
  body: AnswerRequestBody,
  accessScope: RetrievalAccessScope,
  signal?: AbortSignal,
  streamAbortController?: AbortController,
  serverTiming?: string | null,
) {
  const ownerId = accessScope.ownerId;
  const encoder = new TextEncoder();
  const interactionId = randomUUID();
  const observationContext = { interactionId, rolloutMode: "legacy" } as const;
  // Group this request's LLM calls into one Sentry agent-monitoring
  // conversation keyed by the synthetic interaction UUID — never by query text.
  setAgentConversationId(interactionId);

  return new Response(
    new ReadableStream({
      async start(controller) {
        const streamStartedAt = Date.now();
        let completionSent = false;
        // Verified units are append-only within one SSE response. Keep this state in
        // the stream, never globally or across attempts, so duplicate/out-of-order
        // progress callbacks fail closed at the public boundary.
        let lastVerifiedUnitSequence: number | null = null;
        const send = <Name extends AnswerStreamEventName>(event: Name, data: AnswerStreamEventMap[Name]) => {
          try {
            controller.enqueue(encoder.encode(encodeSse(event, data)));
          } catch {
            // The client may cancel between generation callbacks. Once the
            // stream is closed there is no remaining consumer for this frame.
          }
        };
        const sendProgress = (event: unknown) => {
          const publicEvent = toPublicAnswerProgressEvent(event, lastVerifiedUnitSequence);
          if (!publicEvent || (publicEvent.stage === "complete" && completionSent)) return;
          if (publicEvent.stage === "complete") completionSent = true;
          send("progress", publicEvent);
          if (publicEvent.verifiedUnit) lastVerifiedUnitSequence = publicEvent.verifiedUnit.sequence;
        };
        const sendComplete = () => {
          sendProgress({ stage: "complete", elapsedMs: Date.now() - streamStartedAt });
        };
        const sendFinal = (data: AnswerStreamEventMap["final"]) => {
          sendComplete();
          send("final", data);
        };
        // Generation can go silent for long stretches while the model reasons
        // and deterministic gates run; heartbeat comments keep the connection
        // visibly alive without exposing provisional clinical prose.
        const stopHeartbeat = startSseHeartbeat((frame) => controller.enqueue(encoder.encode(frame)));
        const onProgress = (event: AnswerProgressEvent) => sendProgress(event);
        try {
          sendProgress({ stage: "scoping" });
          const scope = isDemoMode()
            ? null
            : await resolveSearchScope({
                supabase: createAdminClient(),
                accessScope,
                documentIds:
                  body.summaryMode && body.documentId
                    ? [body.documentId]
                    : (body.documentIds ?? (body.documentId ? [body.documentId] : undefined)),
                filters: body.filters,
                signal,
              });
          sendProgress({ stage: "retrieving" });
          if (scope?.documentIds?.length === 0) {
            const governedEmptyResponse = buildGovernedEmptyScopeAnswerClientResponse(emptyScopeAnswer);
            const emptyAnswer = observeRagAnswer(governedEmptyResponse.telemetryAnswer, observationContext);
            await persistAnswerDiagnostics({
              supabase: createAdminClient(),
              query: body.query,
              ownerId,
              interactionId,
              answer: emptyAnswer,
            });
            sendFinal({
              ...governedEmptyResponse.payload,
              scope: toClientSearchScopeSummary(scope, body.queryMode),
              ...answerFeedbackMetadata(interactionId, emptyScopeAnswer),
            });
            return;
          }
          if (isDemoMode()) {
            sendFinal({ ...buildDemoStreamAnswer(body), interactionId });
            return;
          }

          const singleDocumentScope = Boolean(
            body.documentId && !body.documentIds?.length && scope?.activeFilterCount === 0,
          );
          if (body.summaryMode) {
            sendProgress({ stage: "analyzing", message: "Reading the committed document sections." });
            sendProgress({ stage: "generating", message: "Building the governed clinical summary." });
          }
          const answer = await runAnswerWithPilotBudget(
            {
              ownerId,
              documentId: body.documentId ?? (body.documentIds?.length === 1 ? body.documentIds[0] : undefined),
              query: body.query,
              queryMode: body.queryMode,
              summaryMode: body.summaryMode,
              activeFilterCount: scope?.activeFilterCount,
              resolvedDocumentIds: scope?.documentIds,
            },
            () =>
              body.summaryMode && body.documentId
                ? summarizeDocument(body.documentId, ownerId, { signal, observationContext })
                : answerQuestionWithScope({
                    ...registeredPublicAnswerOptions({
                      requesterId: ownerId,
                      accessScope,
                      explicitDocumentIds: body.documentIds ?? (body.documentId ? [body.documentId] : undefined),
                      resolvedDocumentIds: scope?.documentIds,
                      signal,
                    }),
                    query: body.query,
                    documentId: singleDocumentScope ? body.documentId : undefined,
                    documentIds: singleDocumentScope
                      ? undefined
                      : (scope?.documentIds ?? body.documentIds ?? (body.documentId ? [body.documentId] : undefined)),
                    ownerId,
                    accessScope,
                    allowGlobalSearch: !ownerId,
                    queryMode: body.queryMode,
                    observationContext,
                    onProgress,
                    signal,
                  }),
          );
          const governedResponse = buildGovernedAnswerClientResponse(answer);

          await persistAnswerDiagnostics({
            supabase: createAdminClient(),
            query: body.query,
            ownerId,
            interactionId,
            answer: governedResponse.telemetryAnswer,
          });

          sendFinal({
            ...governedResponse.payload,
            scope: scope ? toClientSearchScopeSummary(scope, body.queryMode) : undefined,
            ...streamAnswerFeedbackMetadata(interactionId, governedResponse.payload.answer),
          });
        } catch (error) {
          // Parity with /api/answer (PR #315): outside production, a misconfigured
          // Supabase API key degrades to a visible demo answer instead of a stream
          // error — the UI's answer search uses this route, not /api/answer.
          const fallbackReason =
            error instanceof AnswerPilotBudgetError ? null : nonProductionSupabaseDemoFallbackReason(error);
          if (fallbackReason) {
            sendFinal({ ...buildDemoStreamAnswer(body, fallbackReason), interactionId });
            return;
          }
          logStreamError(error, signal);
          const streamError = streamErrorPayload(error);
          send("error", streamError);
        } finally {
          stopHeartbeat();
          // The client may have already cancelled the stream (Stop button /
          // watchdog abort), in which case close() throws on a closed stream.
          try {
            controller.close();
          } catch {
            // Stream already closed or cancelled — nothing left to release.
          }
        }
      },
      cancel() {
        streamAbortController?.abort();
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Only the pre-stream preamble stages can appear here — headers flush
        // before the first frame, so in-stream durations are not yet known.
        ...(serverTiming ? { "Server-Timing": serverTiming } : {}),
      },
    },
  );
}

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody(request, answerRequestSchema, "Invalid answer request.");
    // Refuse a question that looks like it holds a patient detail before it reaches the
    // AI service (audit S2, 2026-10-13). The page checks first; this is the backstop.
    rejectPatientDetailQuestion(body);
    const streamAbortController = new AbortController();
    const streamSignal = mergeAbortSignals([request.signal, streamAbortController.signal]);
    if (isDemoMode()) return streamAnswer(body, resolveRetrievalAccessScope(), streamSignal, streamAbortController);

    const supabase = createAdminClient();
    const authStartedAt = Date.now();
    const access = await publicAccessContext(request, supabase);
    const authMs = Date.now() - authStartedAt;

    const rateLimitStartedAt = Date.now();
    if (body.summaryMode) {
      const decision = await consumeSummaryRateLimits({
        supabase,
        subject: access.rateLimitSubject,
      });
      if (decision.rateLimit.limited) {
        return decision.bucket === "document_summarize"
          ? documentSummaryRateLimitStream(decision.rateLimit)
          : rateLimitStream(decision.rateLimit);
      }
    } else {
      const rateLimit = await consumeSubjectApiRateLimit({
        supabase,
        subject: access.rateLimitSubject,
        bucket: "answer",
        allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
      });
      if (rateLimit.limited) return rateLimitStream(rateLimit);
    }
    const rateLimitMs = Date.now() - rateLimitStartedAt;

    return streamAnswer(
      body,
      resolveRetrievalAccessScope(access.ownerId),
      streamSignal,
      streamAbortController,
      buildServerTimingHeader(preambleServerTimingEntries({ authMs, rateLimitMs })),
    );
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return unauthorizedResponse(error);
    }
    if (error instanceof z.ZodError) {
      return jsonError(error, 400);
    }
    if (error instanceof PublicApiError) {
      return jsonError(error, error.status);
    }
    if (error instanceof Error) {
      return jsonError(new PublicApiError("Answer processing failed.", 500, { code: error.name }), 500);
    }
    return jsonError("Answer processing failed.", 500);
  }
}
