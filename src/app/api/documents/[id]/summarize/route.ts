import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { demoSummary, getDemoDocument } from "@/lib/demo-data";
import { isDemoMode } from "@/lib/env";
import { documentSummaryQuestion } from "@/lib/answer-contract";
import { summarizeDocument } from "@/lib/rag/rag";
import {
  buildGovernedAnswerClientResponse,
  buildGovernedDemoAnswerClientResponse,
  governedAnswerForTelemetry,
} from "@/lib/answer-response";
import { logAnswerDiagnostics } from "@/lib/answer-telemetry";
import { answerFeedbackMetadata } from "@/lib/answer-feedback-token";
import { jsonError } from "@/lib/http";
import { consumeApiRateLimit, rateLimitJsonResponse } from "@/lib/api-rate-limit";
import { setAgentConversationId } from "@/lib/observability/agent-monitoring";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseRouteParams } from "@/lib/validation/params";

export const runtime = "nodejs";

const summarizeRouteParamsSchema = z.object({
  id: z.string().uuid(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await params;
    const { id } = parseRouteParams({ id: rawId }, summarizeRouteParamsSchema, "Invalid document id.");
    if (isDemoMode()) {
      if (!getDemoDocument(id)) {
        return NextResponse.json({ error: "Demo document not found." }, { status: 404 });
      }
      return NextResponse.json({
        ...buildGovernedDemoAnswerClientResponse(demoSummary(id)),
        interactionId: randomUUID(),
      });
    }

    const supabase = createAdminClient();
    const user = await requireAuthenticatedUser(request, supabase, { administrator: true });
    const rateLimit = await consumeApiRateLimit({ supabase, ownerId: user.id, bucket: "document_summarize" });
    if (rateLimit.limited)
      return rateLimitJsonResponse("Too many document summary requests. Retry shortly.", rateLimit);
    // Group this request's LLM calls into one Sentry agent-monitoring conversation
    // before any OpenAI work starts. Synthetic UUID only — never document/query text.
    const interactionId = randomUUID();
    const observationContext = { interactionId, rolloutMode: "legacy" as const };
    setAgentConversationId(interactionId);
    const answer = await summarizeDocument(id, user.id, {
      signal: request.signal,
      observationContext,
      finalizeTelemetryAnswer: governedAnswerForTelemetry,
    });
    const governedResponse = buildGovernedAnswerClientResponse(answer);
    logAnswerDiagnostics({
      supabase,
      query: documentSummaryQuestion,
      ownerId: user.id,
      answer: governedResponse.telemetryAnswer,
      observationContext,
    });
    return NextResponse.json({
      ...governedResponse.payload,
      ...answerFeedbackMetadata(interactionId, governedResponse.payload.answer),
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return unauthorizedResponse();
    }
    if (error instanceof Error && error.message === "Document not found.") {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }
    return jsonError(error);
  }
}
