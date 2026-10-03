import * as Sentry from "@sentry/nextjs";
import { createClient } from "@supabase/supabase-js";

import {
  isSentryDbTracingEnabled,
  privacySafeErrorEvent,
  privacySafeTransactionEvent,
  resolveTracesSampleRate,
} from "@/lib/observability/error-tracking";
import { registerSentryLogForwarder } from "@/lib/logger";
import { resolveSentryRelease } from "@/lib/observability/sentry-release";
import {
  forwardAppLogToSentry,
  isSentryLoggingEnabled,
  privacySafeLog,
  sendSentryTestLog,
} from "@/lib/observability/sentry-logging";

const sentryEnvironment = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development";
const sentryDsn = process.env.SENTRY_DSN?.trim();
const tracesSampleRate = resolveTracesSampleRate();
const sentryRelease = resolveSentryRelease();
const sentryLogsEnabled = isSentryLoggingEnabled();

// Sentry applies `ignoreErrors` before `beforeSend`: a string entry is a
// substring match and a RegExp is `.test()`, each tried against the exception
// value, `${type}: ${value}` and the event message. Every entry here is therefore
// a start-anchored regex naming one intended shape. A bare `/404/`, `/Not Found/i`
// or "NotFound" also dropped a Supabase Storage 404 during upload cleanup, a
// provider 404 for a retired resource, and any future error type containing the
// fragment — failures an operator must see (2026-09-02 audit, L8). Pinned by
// tests/sentry-ignore-errors.test.ts.
const ignoredServerErrors = [
  // Next.js `notFound()`: the error's message is its digest (current and legacy).
  /^NEXT_HTTP_ERROR_FALLBACK;404$/,
  /^NEXT_NOT_FOUND$/,
  // HTTP-client 404 text, exact.
  /^Request failed with status code 404$/i,
  // Framework not-found error types (`Type: value`) and the exact value alone.
  /^NotFound(?:Error)?(?::|$)/,
  /^Not Found$/i,
  // A missing module or chunk on a stale deploy; HTML served where JSON was expected.
  /^Cannot find module /i,
  /^SyntaxError: Unexpected token </,
  // This app's own deliberate rejections, anchored on the error type.
  /^BotAccessDenied(?::|$)/,
  /^RateLimitedError(?::|$)/,
];

function isBotTrafficEvent(event: Sentry.Event): boolean {
  const userAgentHeader = event.request?.headers?.["user-agent"];
  const userAgent = Array.isArray(userAgentHeader) ? userAgentHeader[0] : (userAgentHeader as string | undefined);
  if (!userAgent) return false;
  return /bot|spider|crawler|curl|python|monitoring|uptimerobot|semrush|ahrefs|pingdom|headless|googlebot|bingbot|duckduckgo|petalbot/i.test(
    userAgent,
  );
}

/** Bootstrap client used only to attach constructor-level Supabase DB instrumentation. */
function supabaseTracingIntegrations() {
  // Inert unless DSN is set and tracing sample rate is > 0 (docs/error-tracking.md).
  if (!isSentryDbTracingEnabled()) {
    return [];
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) {
    return [];
  }

  try {
    const supabaseClient = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    return [
      Sentry.supabaseIntegration({
        supabaseClient,
        // Never attach PostgREST filter values or mutation bodies — clinical privacy.
        sendOperationData: false,
      }),
    ];
  } catch {
    return [];
  }
}

try {
  Sentry.init({
    ...(sentryDsn ? { dsn: sentryDsn } : {}),
    release: sentryRelease,
    environment: sentryEnvironment,
    // Performance tracing for DB query dashboards. Override with SENTRY_TRACES_SAMPLE_RATE
    // (0 disables). Query filters/bodies stay redacted — see docs/error-tracking.md.
    tracesSampleRate,
    // Sentry 11 removed `sendDefaultPii`; with `dataCollection` set it was
    // already ignored in v10, so collection is unchanged. v11 also streams spans
    // by default, which skips `beforeSendTransaction`: keep the static lifecycle
    // so every transaction still passes privacySafeTransactionEvent.
    traceLifecycle: "static",
    dataCollection: {
      databaseQueryData: false,
      // Defense in depth for AI agent monitoring: the OpenAI wrap in
      // agent-monitoring.ts already sets recordInputs/recordOutputs false, and
      // privacySafeTransactionEvent strips prompt/output attributes on export.
      genAI: { inputs: false, outputs: false },
    },
    includeLocalVariables: false,
    // Structured Sentry Logs (opt out with SENTRY_ENABLE_LOGS=false). Console
    // capture stays off — only allowlisted messages/attributes pass beforeSendLog.
    // Sentry 11 removed `enableLogs`, so the opt-out gate now lives in beforeSendLog.
    attachStacktrace: true,
    maxBreadcrumbs: 0,
    ignoreErrors: ignoredServerErrors,
    integrations: supabaseTracingIntegrations(),
    beforeSend(event) {
      if (isBotTrafficEvent(event)) return null;
      return privacySafeErrorEvent(event);
    },
    beforeSendTransaction(event) {
      if (isBotTrafficEvent(event)) return null;
      // Local scrubber shape is structural; cast back to the SDK transaction type.
      return privacySafeTransactionEvent(event) as typeof event;
    },
    beforeSendLog(log) {
      if (!sentryLogsEnabled) return null;
      return privacySafeLog(log as Parameters<typeof privacySafeLog>[0]) as typeof log | null;
    },
  });
  if (sentryLogsEnabled) {
    registerSentryLogForwarder(forwardAppLogToSentry);
    // Opt-in wizard verify sample only — never hardcoded DSN, never console capture.
    sendSentryTestLog();
  }
} catch {
  // Optional observability must never take down the clinical server.
}
