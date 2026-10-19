import "server-only";

import * as Sentry from "@sentry/nextjs";

import { resolveTracesSampleRate } from "@/lib/observability/error-tracking";

/**
 * Node-only OpenAI client instrumentation for privacy-safe AI agent monitoring.
 * Kept out of `error-tracking.ts` for the same reason as `supabase-tracing.ts`:
 * Edge instrumentation imports the scrubbers without pulling the Node Sentry entry.
 */

/**
 * Agent monitoring is span-based, so it needs a DSN, a positive traces sample
 * rate, AND a runtime where `Sentry.init()` actually ran (`src/sentry.*.config.ts`
 * via Next instrumentation). The client gate keeps the wrap inert in the
 * ingestion worker and in tests, which import this module but never init Sentry.
 */
export function isSentryAgentMonitoringEnabled(): boolean {
  try {
    return Boolean(process.env.SENTRY_DSN?.trim()) && resolveTracesSampleRate() > 0 && Boolean(Sentry.getClient());
  } catch {
    return false;
  }
}

/**
 * Wrap an OpenAI client so `responses.create` / `embeddings.create` emit gen_ai
 * spans (model, operation, latency, token usage). Inputs and outputs are never
 * recorded — clinical queries, source evidence, and generated answers must not
 * leave the server. `privacySafeTransactionEvent` enforces the same boundary
 * again on export (docs/error-tracking.md).
 */
export function instrumentOpenAIClientForAgentMonitoring<T extends object>(client: T): T {
  if (!isSentryAgentMonitoringEnabled()) {
    return client;
  }

  try {
    return Sentry.instrumentOpenAiClient(client, {
      recordInputs: false,
      recordOutputs: false,
    });
  } catch {
    // Optional observability must never take down answer generation.
    return client;
  }
}

/**
 * Group every LLM call made while serving one answer request into a single
 * Sentry agent-monitoring conversation. The id must be the request's synthetic
 * interaction UUID — never query text or any derived clinical identifier.
 */
export function setAgentConversationId(conversationId: string): void {
  // Only UUID syntax crosses this boundary; callers must use the generated
  // interaction UUID, never a patient/document identifier or clinical text.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId)) return;
  if (!isSentryAgentMonitoringEnabled()) {
    return;
  }

  try {
    // The SDK's Node convenience export delegates to this public Scope API.
    // Next's Edge entry omits that export but exposes the same isolation scope.
    Sentry.getIsolationScope().setConversationId(conversationId);
  } catch {
    // Optional observability must never take down answer generation.
  }
}
