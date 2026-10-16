import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { demoAnswer } from "@/lib/demo-data";
import { isDemoMode } from "@/lib/env";
import { answerQuestionWithScope } from "@/lib/rag/rag";
import { jsonError, PublicApiError } from "@/lib/http";
import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { publicAccessContext } from "@/lib/public-api-access";
import { setAgentConversationId } from "@/lib/observability/agent-monitoring";
import { classifyRagQuery } from "@/lib/clinical-search";
import { buildSmartRagApiPlan } from "@/lib/smart-rag-api";
import { queryClassForClinicalMode, queryForClinicalMode } from "@/lib/clinical-query-mode";
import { resolveSearchScope } from "@/lib/search-scope";
import { resolveRetrievalAccessScope } from "@/lib/owner-scope";
import { parseJsonBody } from "@/lib/validation/body";
import { rejectPatientDetailQuestion } from "@/lib/clinical-question-patient-check-server";
import {
  buildGovernedAnswerClientResponse,
  buildGovernedDemoAnswerClientResponse,
  buildGovernedEmptyScopeAnswerClientResponse,
} from "@/lib/answer-response";
import { answerServerTimingEntries, buildServerTimingHeader, preambleServerTimingEntries } from "@/lib/server-timing";
import { createAdminClient } from "@/lib/supabase/admin";
import { persistAnswerDiagnostics } from "@/lib/answer-telemetry";
import { nonProductionSupabaseDemoFallbackReason } from "@/lib/supabase/errors";
import * as serverAuth from "@/lib/supabase/auth";
import { answerRequestSchema, type AnswerRequestBody } from "@/lib/validation/answer-request";
import { answerFeedbackMetadata } from "@/lib/answer-feedback-token";
import { observeRagAnswer } from "@/lib/rag/rag-programme-telemetry";
import { toClientSearchScopeSummary } from "@/lib/answer-client-payload";
import { registeredPublicAnswerOptions } from "@/lib/registered-public-answer-options";
import { runAnswerWithPilotBudget } from "@/lib/answer-pilot-budget";

export const runtime = "nodejs";

const emptyScopeAnswer =
  "The selected filters did not match any indexed documents, so I cannot generate an answer for that scope.";

function buildDemoAnswerPayload(body: AnswerRequestBody, fallbackReason?: string) {
  const answer = demoAnswer(body.query, body.documentId, body.documentIds);
  const answerFocusQuery = queryForClinicalMode(body.query, body.queryMode);
  const smartApiPlan = buildSmartRagApiPlan({
    query: answerFocusQuery,
    queryClass: queryClassForClinicalMode(body.queryMode) ?? classifyRagQuery(answerFocusQuery).queryClass,
    results: answer.sources,
    routeMode: answer.routingMode,
    retrievalStrategy: "hybrid",
  });
  return buildGovernedDemoAnswerClientResponse(
    {
      ...answer,
      responseMode: smartApiPlan.displayMode,
      smartApiPlan,
    },
    fallbackReason,
  );
}

export async function POST(request: Request) {
  const interactionId = randomUUID();
  const observationContext = { interactionId, rolloutMode: "legacy" } as const;
  // Group this request's LLM calls (embedding, generation, verification) into
  // one Sentry agent-monitoring conversation keyed by the synthetic interaction
  // UUID — never by query text.
  setAgentConversationId(interactionId);
  const routeStartedAt = Date.now();
  let body: AnswerRequestBody | null = null;
  try {
    const answerBody = await parseJsonBody(request, answerRequestSchema, "Invalid answer request.");
    // Refuse a question that looks like it holds a patient detail before it reaches the
    // AI service (audit S2, 2026-10-13). The page checks first; this is the backstop.
    rejectPatientDetailQuestion(answerBody);
    if (answerBody.summaryMode) {
      return jsonError(
        new PublicApiError("Document summaries require the streaming answer endpoint.", 400, {
          code: "summary_mode_stream_required",
        }),
        400,
      );
    }
    body = answerBody;
    if (isDemoMode()) {
      return NextResponse.json({ ...buildDemoAnswerPayload(answerBody), interactionId });
    }

    const supabase = createAdminClient();
    const authStartedAt = Date.now();
    const access = await publicAccessContext(request, supabase);
    const authMs = Date.now() - authStartedAt;
    const accessScope = resolveRetrievalAccessScope(access.ownerId);

    // Admit before scope: resolveSearchScope can enumerate thousands of documents
    // and labels. Overlapping it with the limiter left that work in flight on 429
    // (abort cannot undo queries already accepted by PostgREST). Keep the signal
    // so a client disconnect still cancels scope's paginated queries.
    const rateLimitStartedAt = Date.now();
    const rateLimit = await consumeSubjectApiRateLimit({
      supabase,
      subject: access.rateLimitSubject,
      bucket: "answer",
      allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
    });
    const rateLimitMs = Date.now() - rateLimitStartedAt;
    if (rateLimit.limited) {
      return rateLimitJsonResponse("Too many answer requests. Retry shortly.", rateLimit, { bucket: "answer" });
    }

    const scopeStartedAt = Date.now();
    const scope = await resolveSearchScope({
      supabase,
      accessScope,
      documentIds: answerBody.documentIds ?? (answerBody.documentId ? [answerBody.documentId] : undefined),
      filters: answerBody.filters,
      signal: request.signal,
    });
    const scopeMs = Date.now() - scopeStartedAt;
    if (scope.documentIds?.length === 0) {
      const governedEmptyResponse = buildGovernedEmptyScopeAnswerClientResponse(emptyScopeAnswer);
      const emptyAnswer = observeRagAnswer(governedEmptyResponse.telemetryAnswer, observationContext);
      await persistAnswerDiagnostics({
        supabase,
        query: answerBody.query,
        ownerId: access.ownerId,
        interactionId,
        answer: emptyAnswer,
      });
      const serverTiming = buildServerTimingHeader([
        ...preambleServerTimingEntries({ authMs, rateLimitMs, scopeMs }),
        { name: "total", durMs: Date.now() - routeStartedAt },
      ]);
      return NextResponse.json(
        {
          ...governedEmptyResponse.payload,
          scope: toClientSearchScopeSummary(scope, answerBody.queryMode),
          ...answerFeedbackMetadata(interactionId, emptyScopeAnswer),
        },
        serverTiming ? { headers: { "Server-Timing": serverTiming } } : undefined,
      );
    }

    const singleDocumentScope = Boolean(
      answerBody.documentId && !answerBody.documentIds?.length && scope.activeFilterCount === 0,
    );
    const answer = await runAnswerWithPilotBudget(
      {
        ownerId: access.ownerId,
        documentId:
          answerBody.documentId ?? (answerBody.documentIds?.length === 1 ? answerBody.documentIds[0] : undefined),
        query: answerBody.query,
        queryMode: answerBody.queryMode,
        summaryMode: answerBody.summaryMode,
        activeFilterCount: scope.activeFilterCount,
        resolvedDocumentIds: scope.documentIds,
      },
      () =>
        answerQuestionWithScope({
          ...registeredPublicAnswerOptions({
            requesterId: access.ownerId,
            accessScope,
            explicitDocumentIds:
              answerBody.documentIds ?? (answerBody.documentId ? [answerBody.documentId] : undefined),
            resolvedDocumentIds: scope.documentIds,
            signal: request.signal,
          }),
          query: answerBody.query,
          documentId: singleDocumentScope ? answerBody.documentId : undefined,
          documentIds: singleDocumentScope
            ? undefined
            : (scope.documentIds ??
              answerBody.documentIds ??
              (answerBody.documentId ? [answerBody.documentId] : undefined)),
          ownerId: access.ownerId,
          accessScope,
          allowGlobalSearch: !access.ownerId,
          queryMode: answerBody.queryMode,
          observationContext,
          signal: request.signal,
        }),
    );
    const governedResponse = buildGovernedAnswerClientResponse(answer);
    await persistAnswerDiagnostics({
      supabase,
      query: answerBody.query,
      ownerId: access.ownerId,
      interactionId,
      answer: governedResponse.telemetryAnswer,
    });

    // Durations only — see server-timing.ts for the trust-boundary constraint.
    const serverTiming = buildServerTimingHeader([
      ...preambleServerTimingEntries({ authMs, rateLimitMs, scopeMs }),
      ...answerServerTimingEntries(answer.latencyTimings, Date.now() - routeStartedAt),
    ]);
    return NextResponse.json(
      {
        ...governedResponse.payload,
        scope: toClientSearchScopeSummary(scope, answerBody.queryMode),
        ...answerFeedbackMetadata(interactionId, governedResponse.payload.answer),
      },
      serverTiming ? { headers: { "Server-Timing": serverTiming } } : undefined,
    );
  } catch (error) {
    if (error instanceof serverAuth.AuthenticationError) {
      return serverAuth.unauthorizedResponse(error);
    }
    if (error instanceof z.ZodError) {
      return jsonError(error, 400);
    }
    if (error instanceof PublicApiError) {
      return jsonError(error, error.status);
    }
    if (error instanceof Error) {
      const fallbackBody = body;
      const fallbackReason =
        fallbackBody && process.env.NODE_ENV !== "production" ? nonProductionSupabaseDemoFallbackReason(error) : null;
      if (fallbackBody && fallbackReason) {
        return NextResponse.json(
          { ...buildDemoAnswerPayload(fallbackBody, fallbackReason), interactionId },
          { headers: { "X-Clinical-KB-Fallback": fallbackReason } },
        );
      }
      return jsonError(
        new PublicApiError("Answer generation failed. Retry with a narrower question.", 500, { code: error.name }),
        500,
      );
    }
    return jsonError("Answer generation failed.", 500);
  }
}
