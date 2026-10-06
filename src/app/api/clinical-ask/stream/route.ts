import { randomUUID } from "node:crypto";
import { z } from "zod";
import { answerFeedbackMetadata, hashAnswerForFeedback } from "@/lib/answer-feedback-token";
import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { ClinicalAskSseEncoder, clinicalAskHeartbeatFrame } from "@/lib/clinical-ask-stream-contract";
import { retrieveCatalogueEvidence } from "@/lib/clinical-ask/catalogue-evidence";
import {
  authorityDomainsForProfile,
  clinicalAskEnabled,
  clinicalAskExternalSearchEnabled,
  clinicalAskModeEnabled,
} from "@/lib/clinical-ask/authority-registry";
import { identifierShapeWarning } from "@/lib/clinical-ask/context";
import type {
  ClinicalAskDependencies,
  ClinicalAskFinalPayload,
  ClinicalAskRequest,
} from "@/lib/clinical-ask/contracts";
import { retrieveIndexedEvidence } from "@/lib/clinical-ask/indexed-evidence";
import { retrieveExternalEvidence } from "@/lib/clinical-ask/external-evidence";
import { runClinicalAsk } from "@/lib/clinical-ask/orchestrator";
import { suggestClinicalAskContext, synthesizeClinicalAskDraft } from "@/lib/clinical-ask/synthesis";
import { PublicApiError, jsonError } from "@/lib/http";
import { setAgentConversationId } from "@/lib/observability/agent-monitoring";
import { resolveRetrievalAccessScope } from "@/lib/owner-scope";
import { publicAccessContext } from "@/lib/public-api-access";
import { buildServerTimingHeader, preambleServerTimingEntries } from "@/lib/server-timing";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, unauthorizedResponse } from "@/lib/supabase/auth";
import { clinicalAskRequestSchema } from "@/lib/validation/clinical-ask-request";
import { parseJsonBody } from "@/lib/validation/body";

export const runtime = "nodejs";

function mergeAbortSignals(signals: AbortSignal[]) {
  return AbortSignal.any(signals);
}

function containsIdentifier(request: ClinicalAskRequest) {
  const context = Object.values(request.confirmedContext).flatMap((value) =>
    Array.isArray(value) ? value : value ? [value] : [],
  );
  return [request.question, ...context, ...Object.values(request.clarificationAnswers)]
    .filter((value): value is string => typeof value === "string")
    .some(identifierShapeWarning);
}

function visibleAnswerText(response: Extract<ClinicalAskFinalPayload["response"], { state: "answered" }>) {
  return [
    response.lead.text,
    ...response.sections.flatMap((section) => section.claims.map((claim) => claim.text)),
    ...response.conflicts.map((claim) => claim.text),
  ]
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

function feedbackPayload(interactionId: string, response: ClinicalAskFinalPayload["response"]) {
  if (response.state !== "answered") return null;
  const canonicalText = visibleAnswerText(response);
  const metadata = answerFeedbackMetadata(interactionId, canonicalText);
  if (!("feedbackToken" in metadata) || !metadata.feedbackToken) return null;
  return { interactionId, answerHash: hashAnswerForFeedback(canonicalText), feedbackToken: metadata.feedbackToken };
}

function dependencies(): ClinicalAskDependencies {
  return {
    suggestContext: suggestClinicalAskContext,
    retrieveCatalogue: retrieveCatalogueEvidence,
    retrieveIndexed: retrieveIndexedEvidence,
    retrieveExternal: (request, allowedAuthorityIds, signal) =>
      clinicalAskExternalSearchEnabled(request.mode)
        ? retrieveExternalEvidence(request, authorityDomainsForProfile(request.mode, allowedAuthorityIds), signal)
        : Promise.resolve([]),
    synthesize: synthesizeClinicalAskDraft,
  };
}

function streamHeaders(serverTiming?: string | null) {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
    ...(serverTiming ? { "Server-Timing": serverTiming } : {}),
  };
}

function errorStream(
  code: "identifiable_input_blocked" | "mode_unavailable" | "internal_error",
  message: string,
  serverTiming?: string | null,
) {
  const encoder = new ClinicalAskSseEncoder();
  return new Response(encoder.encode({ type: "error", code, retryable: false, message }), {
    headers: streamHeaders(serverTiming),
  });
}

function clinicalAskStream(
  body: ClinicalAskRequest,
  accessScope: ReturnType<typeof resolveRetrievalAccessScope>,
  signal: AbortSignal,
  cancel: AbortController,
  serverTiming: string | null,
) {
  const interactionId = randomUUID();
  setAgentConversationId(interactionId);
  const textEncoder = new TextEncoder();
  const sse = new ClinicalAskSseEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: Parameters<ClinicalAskSseEncoder["encode"]>[0]) => {
          const frame = textEncoder.encode(sse.encode(event));
          try {
            controller.enqueue(frame);
            return true;
          } catch {
            // Cancellation can race a terminal frame after the encoder has
            // already committed its one-terminal-event state. Do not re-enter
            // the encoder with a synthetic error or reject start().
            if (!cancel.signal.aborted) {
              cancel.abort(new DOMException("Clinical Ask stream cancelled.", "AbortError"));
            }
            return false;
          }
        };
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(textEncoder.encode(clinicalAskHeartbeatFrame));
          } catch {
            clearInterval(heartbeat);
          }
        }, 15_000);
        (heartbeat as unknown as { unref?: () => void }).unref?.();
        try {
          const response = await runClinicalAsk(body, accessScope, dependencies(), signal, send);
          send({
            type: "final",
            payload: { response, feedback: feedbackPayload(interactionId, response) },
          });
        } catch (error) {
          if (
            signal.aborted ||
            (error instanceof DOMException && error.name === "AbortError") ||
            (error as { name?: string })?.name === "AbortError"
          ) {
            // Client cleanly aborted or navigated away — do not emit internal_error frame.
            return;
          }
          send({ type: "error", code: "internal_error", retryable: true, message: "Clinical Ask failed safely." });
        } finally {
          clearInterval(heartbeat);
          try {
            controller.close();
          } catch {
            // The browser may already have cancelled the stream.
          }
        }
      },
      cancel() {
        cancel.abort(new DOMException("Clinical Ask stream cancelled.", "AbortError"));
      },
    }),
    { headers: streamHeaders(serverTiming) },
  );
}

export async function POST(request: Request) {
  try {
    // Dormant by default: with the master flag off this route does not exist.
    // Answer before body parsing, the auth lookup, or the durable rate-limiter
    // write so a switched-off feature costs nothing and confirms nothing (L33).
    // The per-mode emergency denylist keeps its SSE `mode_unavailable` frame.
    // `log: false`: a designed 404 is not a server fault, so it must not write
    // the error-level "API request failed" line that Sentry Logs forwards.
    if (!clinicalAskEnabled()) {
      return jsonError(new PublicApiError("Not found.", 404, { code: "not_found" }), 404, { log: false });
    }
    const body = await parseJsonBody(request, clinicalAskRequestSchema, "Invalid Clinical Ask request.");
    const supabase = createAdminClient();
    const authStarted = Date.now();
    const access = await publicAccessContext(request, supabase);
    const authMs = Date.now() - authStarted;
    const rateStarted = Date.now();
    const rateLimit = await consumeSubjectApiRateLimit({
      supabase,
      subject: access.rateLimitSubject,
      bucket: "clinical_ask",
      allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
    });
    const rateLimitMs = Date.now() - rateStarted;
    if (rateLimit.limited) {
      return rateLimitJsonResponse("Too many Clinical Ask requests. Retry shortly.", rateLimit, {
        bucket: "clinical_ask",
      });
    }
    const serverTiming = buildServerTimingHeader(preambleServerTimingEntries({ authMs, rateLimitMs }));
    if (!clinicalAskModeEnabled(body.mode)) {
      return errorStream("mode_unavailable", "Smart answers are not available for this mode.", serverTiming);
    }
    if (containsIdentifier(body)) {
      return errorStream(
        "identifiable_input_blocked",
        "Remove identifying details before using Clinical Ask.",
        serverTiming,
      );
    }
    const cancel = new AbortController();
    return clinicalAskStream(
      body,
      resolveRetrievalAccessScope(access.ownerId),
      mergeAbortSignals([request.signal, cancel.signal]),
      cancel,
      serverTiming,
    );
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse(error);
    if (error instanceof z.ZodError) return jsonError(error, 400);
    if (error instanceof PublicApiError) return jsonError(error, error.status);
    return jsonError(new PublicApiError("Clinical Ask processing failed.", 500, { code: "internal_error" }), 500);
  }
}
